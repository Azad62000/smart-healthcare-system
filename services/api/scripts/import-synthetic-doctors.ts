import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import pg from "pg";
import { config } from "../src/config.js";
import { assertSyntheticImportEnvironment, validateSyntheticDoctorBundle } from "../src/doctors/synthetic-dataset.js";

const datasetPath = resolve(dirname(fileURLToPath(import.meta.url)), "../seeds/data/synthetic_doctors_200.json");

async function main() {
  assertSyntheticImportEnvironment(config.NODE_ENV, config.DATABASE_URL);
  const raw = JSON.parse(await readFile(datasetPath, "utf8")) as unknown;
  const doctors = validateSyntheticDoctorBundle(raw);
  const pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 1 });
  const client = await pool.connect();
  try {
    for (const doctor of doctors) {
      await client.query("BEGIN");
      try {
        const existingSynthetic = await client.query<{ id: string; user_id: string }>(
          "SELECT id,user_id FROM doctors WHERE synthetic_dataset_id=$1 FOR UPDATE",
          [doctor.source.doctor_id]
        );
        let doctorId = existingSynthetic.rows[0]?.id;
        let userId = existingSynthetic.rows[0]?.user_id;
        if (!userId) {
          const existingAccount = await client.query<{ id: string }>("SELECT id FROM users WHERE lower(email)=lower($1) FOR UPDATE", [doctor.source.email]);
          if (existingAccount.rows[0]) {
            const linkedSynthetic = await client.query<{ id: string; user_id: string }>(
              "SELECT id,user_id FROM doctors WHERE user_id=$1 AND is_synthetic=true AND synthetic_dataset_id=$2 FOR UPDATE",
              [existingAccount.rows[0].id, doctor.source.doctor_id]
            );
            if (!linkedSynthetic.rows[0]) throw new Error("A dataset email conflicts with an existing non-synthetic account; import stopped without modifying it.");
            doctorId = linkedSynthetic.rows[0].id;
            userId = linkedSynthetic.rows[0].user_id;
          } else {
            const inaccessiblePassword = randomBytes(48).toString("base64url");
            const passwordHash = await bcrypt.hash(inaccessiblePassword, 12);
            const insertedUser = await client.query<{ id: string }>(
              `INSERT INTO users(email,password_hash,role,status,email_verified)
               VALUES($1,$2,'Doctor','active',true) RETURNING id`,
              [doctor.source.email, passwordHash]
            );
            userId = insertedUser.rows[0]!.id;
          }
        }

        if (doctorId) {
          await client.query(
            `UPDATE doctors SET given_name=$2,family_name=$3,specialization=$4,qualification=$5,
               experience_years=$6,bio=$7,approval_status=$8,is_synthetic=true,city=$9,state=$10,
               country=$11,consultation_modes=$12,consultation_fee_inr=$13,accepting_appointments=$14,
               updated_at=now()
             WHERE id=$1 AND is_synthetic=true AND synthetic_dataset_id=$15`,
            [doctorId, doctor.givenName, doctor.familyName, doctor.source.specialization, doctor.source.professional_title,
              doctor.source.experience_years, "Synthetic demo profile. Not a verified healthcare provider.",
              doctor.source.is_active ? "approved" : "pending", doctor.source.city, doctor.source.state,
              doctor.source.country, doctor.modes, doctor.source.consultation_fee_inr,
              doctor.source.accepting_appointments, doctor.source.doctor_id]
          );
        } else {
          const insertedDoctor = await client.query<{ id: string }>(
            `INSERT INTO doctors(user_id,given_name,family_name,specialization,qualification,experience_years,
               bio,approval_status,synthetic_dataset_id,is_synthetic,city,state,country,consultation_modes,
               consultation_fee_inr,accepting_appointments)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,true,$10,$11,$12,$13,$14,$15)
             RETURNING id`,
            [userId, doctor.givenName, doctor.familyName, doctor.source.specialization, doctor.source.professional_title,
              doctor.source.experience_years, "Synthetic demo profile. Not a verified healthcare provider.",
              doctor.source.is_active ? "approved" : "pending", doctor.source.doctor_id, doctor.source.city,
              doctor.source.state, doctor.source.country, doctor.modes, doctor.source.consultation_fee_inr,
              doctor.source.accepting_appointments]
          );
          doctorId = insertedDoctor.rows[0]!.id;
        }

        for (const slot of doctor.availability) {
          await client.query(
            `INSERT INTO doctor_availability(doctor_id,starts_at,ends_at) VALUES($1,$2,$3)
             ON CONFLICT(doctor_id,starts_at,ends_at) DO NOTHING`,
            [doctorId, slot.startsAt, slot.endsAt]
          );
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
    process.stdout.write(`Imported ${doctors.length} synthetic demonstration doctors idempotently.\n`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error: unknown) => {
  const summary = error instanceof Error ? error.message : "Synthetic doctor import failed.";
  process.stderr.write(`Synthetic doctor import failed: ${summary}\n`);
  process.exitCode = 1;
});
