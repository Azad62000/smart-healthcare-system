import pg from "pg";
import { config } from "../src/config.js";
import { assertSyntheticImportEnvironment } from "../src/doctors/synthetic-dataset.js";

async function main() {
  assertSyntheticImportEnvironment(config.NODE_ENV, config.DATABASE_URL);
  const pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 1 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const candidates = await client.query<{ id: string; user_id: string }>(
      `SELECT id,user_id FROM doctors
       WHERE is_synthetic=true AND synthetic_dataset_id LIKE 'DOC-DEMO-%'
       ORDER BY synthetic_dataset_id FOR UPDATE`
    );
    if (!candidates.rows.length) {
      await client.query("COMMIT");
      process.stdout.write("No imported synthetic doctor profiles were found.\n");
      return;
    }
    const doctorIds = candidates.rows.map((row) => row.id);
    const userIds = candidates.rows.map((row) => row.user_id);
    const references = await client.query<{ retained: boolean }>(
      `SELECT (
        EXISTS(SELECT 1 FROM appointments WHERE doctor_id=ANY($1::uuid[]))
        OR EXISTS(SELECT 1 FROM consultation_records WHERE doctor_id=ANY($1::uuid[]))
        OR EXISTS(SELECT 1 FROM prescriptions WHERE doctor_id=ANY($1::uuid[]))
        OR EXISTS(SELECT 1 FROM care_conversations WHERE doctor_id=ANY($1::uuid[]))
        OR EXISTS(SELECT 1 FROM appointment_documents WHERE doctor_id=ANY($1::uuid[]))
        OR EXISTS(SELECT 1 FROM admin_audit_events WHERE target_doctor_id=ANY($1::uuid[])
          OR actor_user_id=ANY($2::uuid[]) OR target_user_id=ANY($2::uuid[]))
        OR EXISTS(SELECT 1 FROM health_record_access_events WHERE actor_user_id=ANY($2::uuid[]))
        OR EXISTS(SELECT 1 FROM prescription_access_events WHERE actor_user_id=ANY($2::uuid[]))
        OR EXISTS(SELECT 1 FROM appointment_status_history WHERE actor_user_id=ANY($2::uuid[]))
        OR EXISTS(SELECT 1 FROM appointment_document_access_events WHERE actor_user_id=ANY($2::uuid[]))
        OR EXISTS(SELECT 1 FROM teleconsultation_events WHERE actor_user_id=ANY($2::uuid[]))
        OR EXISTS(SELECT 1 FROM consultation_note_drafts WHERE finalized_by=ANY($2::uuid[])
          OR doctor_id=ANY($1::uuid[]))
      ) AS retained`,
      [doctorIds, userIds]
    );
    if (references.rows[0]?.retained) {
      throw new Error("Synthetic profiles have linked appointment, clinical, document, or audit records; no data was removed.");
    }
    await client.query("DELETE FROM doctors WHERE id=ANY($1::uuid[]) AND is_synthetic=true AND synthetic_dataset_id LIKE 'DOC-DEMO-%'", [doctorIds]);
    await client.query("DELETE FROM users WHERE id=ANY($1::uuid[]) AND email LIKE '%@example.test' AND role='Doctor'", [userIds]);
    await client.query("COMMIT");
    process.stdout.write(`Removed ${doctorIds.length} unreferenced synthetic demonstration doctors.\n`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error: unknown) => {
  const summary = error instanceof Error ? error.message : "Synthetic doctor removal failed.";
  process.stderr.write(`Synthetic doctor removal failed: ${summary}\n`);
  process.exitCode = 1;
});
