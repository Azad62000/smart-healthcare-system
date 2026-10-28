import type { Pool, PoolClient } from "pg";
import { ApiRequestError } from "../request-error.js";
import { MedicalDataCrypto, licenseAdditionalData } from "../medical-data-crypto.js";
import type { DoctorApprovalStatus, DoctorAvailability, DoctorProfile, DoctorProfileInput, DoctorRepository } from "./types.js";

interface DoctorRow { id: string; user_id: string; given_name: string; family_name: string; specialization: string; qualification: string | null; experience_years: number | null; bio: string | null; approval_status: DoctorApprovalStatus; created_at: Date; updated_at: Date; is_synthetic: boolean; city: string | null; state: string | null; country: string | null; consultation_modes: Array<"video" | "in_person">; consultation_fee_inr: number | null; accepting_appointments: boolean; rating_average?: number | string | null; rating_count?: number; license_number?: string | null; license_jurisdiction?: string | null; license_status?: "pending" | "verified" | "rejected"; license_review_note?: string | null; }
interface SlotRow { id: string; starts_at: Date; ends_at: Date; }
const doctorColumns = "id, user_id, given_name, family_name, specialization, qualification, experience_years, bio, approval_status, created_at, updated_at, is_synthetic, city, state, country, consultation_modes, consultation_fee_inr, accepting_appointments, license_number, license_jurisdiction, license_status, license_review_note";
const publicDoctorColumns = `${doctorColumns},
  (SELECT round(avg(feedback.rating)::numeric, 1) FROM appointment_feedback feedback WHERE feedback.doctor_id=doctors.id) AS rating_average,
  (SELECT count(*)::int FROM appointment_feedback feedback WHERE feedback.doctor_id=doctors.id) AS rating_count`;

async function publicColumns(db: Pool): Promise<string> {
  const result = await db.query<{ available: boolean }>("SELECT to_regclass('public.appointment_feedback') IS NOT NULL AS available");
  return result.rows[0]?.available ? publicDoctorColumns : doctorColumns;
}

function mapDoctor(row: DoctorRow, availability: DoctorAvailability[] = [], includeLicense = false): DoctorProfile {
  return { id: row.id, userId: row.user_id, givenName: row.given_name, familyName: row.family_name, specialization: row.specialization, qualification: row.qualification, experienceYears: row.experience_years, bio: row.bio, approvalStatus: row.approval_status, isSynthetic: row.is_synthetic, city: row.city, state: row.state, country: row.country, consultationModes: row.consultation_modes, consultationFeeInr: row.consultation_fee_inr, acceptingAppointments: row.accepting_appointments, licenseStatus: row.is_synthetic ? "verified" : row.license_status ?? "pending", ...(includeLicense ? { licenseNumber: row.license_number, licenseJurisdiction: row.license_jurisdiction, licenseReviewNote: row.license_review_note } : {}), ...(row.rating_count !== undefined ? { ratingAverage: row.rating_average === null ? null : Number(row.rating_average), ratingCount: Number(row.rating_count) } : {}), availability, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() };
}
function mapSlot(row: SlotRow): DoctorAvailability { return { id: row.id, startsAt: row.starts_at.toISOString(), endsAt: row.ends_at.toISOString() }; }

async function listSlots(db: Pool | PoolClient, doctorId: string): Promise<DoctorAvailability[]> {
  const result = await db.query<SlotRow>("SELECT id, starts_at, ends_at FROM doctor_availability WHERE doctor_id=$1 AND ends_at > now() ORDER BY starts_at LIMIT 50", [doctorId]);
  return result.rows.map(mapSlot);
}

export class PostgresDoctorRepository implements DoctorRepository {
  constructor(private readonly db: Pool, private readonly allowSynthetic = true, private readonly crypto?: MedicalDataCrypto) {}

  async listApproved(specialization?: string, filters: { city?: string; mode?: "video" | "in_person"; maxFee?: number } = {}): Promise<DoctorProfile[]> {
    const columns = await publicColumns(this.db);
    const result = await this.db.query<DoctorRow>(`SELECT ${columns} FROM doctors WHERE approval_status='approved' AND accepting_appointments=true AND (is_synthetic=true OR license_status='verified')
      AND ($1::text IS NULL OR lower(specialization)=lower($1))
      AND ($2::text IS NULL OR lower(city)=lower($2))
      AND ($3::text IS NULL OR consultation_modes @> ARRAY[$3]::text[])
      AND ($4::integer IS NULL OR (consultation_fee_inr IS NOT NULL AND consultation_fee_inr <= $4))
      AND ($5::boolean OR is_synthetic=false)
      ORDER BY family_name, given_name LIMIT 500`, [specialization ?? null, filters.city ?? null, filters.mode ?? null, filters.maxFee ?? null, this.allowSynthetic]);
    if (result.rows.length === 0) return [];
    const ids = result.rows.map((row) => row.id);
    const slotsResult = await this.db.query<SlotRow & { doctor_id: string }>(
      "SELECT id, doctor_id, starts_at, ends_at FROM doctor_availability WHERE doctor_id = ANY($1::uuid[]) AND ends_at > now() ORDER BY starts_at",
      [ids]
    );
    const slotsByDoctor = new Map<string, DoctorAvailability[]>();
    for (const slot of slotsResult.rows) {
      const list = slotsByDoctor.get(slot.doctor_id) ?? [];
      if (list.length < 50) list.push(mapSlot(slot));
      slotsByDoctor.set(slot.doctor_id, list);
    }
    return result.rows.map((row) => mapDoctor(row, slotsByDoctor.get(row.id) ?? []));
  }

  async listPending(): Promise<DoctorProfile[]> {
    const result = await this.db.query<DoctorRow>(`SELECT ${doctorColumns} FROM doctors WHERE approval_status='pending' OR (approval_status='approved' AND is_synthetic=false AND license_status IS DISTINCT FROM 'verified') ORDER BY created_at, id LIMIT 100`);
    return result.rows.map((row) => {
      const profile = mapDoctor(row, [], true);
      if (profile.licenseNumber?.startsWith("shc1.") && this.crypto) profile.licenseNumber = this.crypto.decryptText(profile.licenseNumber, licenseAdditionalData(row.user_id));
      return profile;
    });
  }

  async findPublicById(id: string): Promise<DoctorProfile | undefined> {
    const columns = await publicColumns(this.db);
    const result = await this.db.query<DoctorRow>(`SELECT ${columns} FROM doctors WHERE id=$1 AND approval_status='approved' AND accepting_appointments=true AND (is_synthetic=true OR license_status='verified') AND ($2::boolean OR is_synthetic=false)`, [id, this.allowSynthetic]);
    return result.rows[0] && mapDoctor(result.rows[0], await listSlots(this.db, result.rows[0].id), true);
  }

  async findByUserId(userId: string): Promise<DoctorProfile | undefined> {
    const result = await this.db.query<DoctorRow>(`SELECT ${doctorColumns} FROM doctors WHERE user_id=$1`, [userId]);
    if (!result.rows[0]) return undefined;
    const profile = mapDoctor(result.rows[0], await listSlots(this.db, result.rows[0].id), true);
    if (profile.licenseNumber?.startsWith("shc1.") && this.crypto) profile.licenseNumber = this.crypto.decryptText(profile.licenseNumber, licenseAdditionalData(userId));
    return profile;
  }

  async saveProfile(userId: string, profile: DoctorProfileInput): Promise<DoctorProfile> {
    const existingLicense = await this.db.query<{ license_number: string | null; license_jurisdiction: string | null }>("SELECT license_number,license_jurisdiction FROM doctors WHERE user_id=$1", [userId]);
    const storedLicense = existingLicense.rows[0]?.license_number ?? null;
    const priorPlaintext = storedLicense?.startsWith("shc1.") && this.crypto
      ? this.crypto.decryptText(storedLicense, licenseAdditionalData(userId))
      : storedLicense;
    const unchangedLicense = priorPlaintext === (profile.licenseNumber ?? null) &&
      existingLicense.rows[0]?.license_jurisdiction === (profile.licenseJurisdiction ?? null);
    const encryptedLicense = unchangedLicense ? storedLicense : profile.licenseNumber && this.crypto
      ? this.crypto.encryptText(profile.licenseNumber, licenseAdditionalData(userId))
      : profile.licenseNumber ?? null;
    const result = await this.db.query<DoctorRow>(
      `INSERT INTO doctors (user_id,given_name,family_name,specialization,qualification,experience_years,bio,license_number,license_jurisdiction,license_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending')
       ON CONFLICT (user_id) DO UPDATE SET given_name=EXCLUDED.given_name, family_name=EXCLUDED.family_name,
         specialization=EXCLUDED.specialization, qualification=EXCLUDED.qualification,
         experience_years=EXCLUDED.experience_years, bio=EXCLUDED.bio,
         license_number=EXCLUDED.license_number, license_jurisdiction=EXCLUDED.license_jurisdiction,
         license_status=CASE WHEN doctors.license_number IS DISTINCT FROM EXCLUDED.license_number OR doctors.license_jurisdiction IS DISTINCT FROM EXCLUDED.license_jurisdiction THEN 'pending' ELSE doctors.license_status END,
         approval_status=CASE WHEN doctors.approval_status='approved' THEN 'pending' ELSE doctors.approval_status END,
         updated_at=now()
       RETURNING ${doctorColumns}`,
      [userId, profile.givenName, profile.familyName, profile.specialization, profile.qualification, profile.experienceYears, profile.bio, encryptedLicense, profile.licenseJurisdiction ?? null]
    );
    const row = result.rows[0]!;
    return mapDoctor(row, await listSlots(this.db, row.id));
  }

  async reviewLicense(doctorId: string, status: "verified" | "rejected", note: string, actorUserId: string, requestId: string): Promise<DoctorProfile | undefined> {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const current = await client.query<DoctorRow>(`SELECT ${doctorColumns} FROM doctors WHERE id=$1 FOR UPDATE`, [doctorId]);
      const row = current.rows[0];
      if (!row) { await client.query("COMMIT"); return undefined; }
      const update = await client.query<DoctorRow>(`UPDATE doctors SET license_status=$2, license_review_note=$3, approval_status=CASE WHEN $2='rejected' THEN 'pending' ELSE approval_status END, updated_at=now() WHERE id=$1 RETURNING ${doctorColumns}`, [doctorId, status, note || null]);
      await client.query(`INSERT INTO admin_audit_events(actor_user_id,target_doctor_id,action,previous_value,new_value,request_id) VALUES($1,$2,'doctor.license.reviewed',$3,$4,$5)`, [actorUserId, doctorId, row.license_status ?? "pending", status, requestId]);
      await client.query("COMMIT");
      const profile = mapDoctor(update.rows[0]!, [], true);
      if (profile.licenseNumber?.startsWith("shc1.") && this.crypto) profile.licenseNumber = this.crypto.decryptText(profile.licenseNumber, licenseAdditionalData(update.rows[0]!.user_id));
      return profile;
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }

  async setApprovalStatus(doctorId: string, status: DoctorApprovalStatus, actorUserId: string, requestId: string): Promise<DoctorProfile | undefined> {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
    const current = await client.query<{ approval_status: DoctorApprovalStatus; license_status: string | null; is_synthetic: boolean }>(
        "SELECT approval_status,license_status,is_synthetic FROM doctors WHERE id=$1 FOR UPDATE",
        [doctorId]
      );
      if (!current.rows[0]) { await client.query("COMMIT"); return undefined; }
      if (status === "approved" && !current.rows[0].is_synthetic && current.rows[0].license_status !== "verified") {
        await client.query("ROLLBACK");
        throw new ApiRequestError(409, "DOCTOR_LICENSE_NOT_VERIFIED", "Verify the professional license before approving this doctor.");
      }
      const result = await client.query<DoctorRow>(`UPDATE doctors SET approval_status=$2, updated_at=now() WHERE id=$1 RETURNING ${doctorColumns}`, [doctorId, status]);
      await client.query(
        `INSERT INTO admin_audit_events(actor_user_id,target_doctor_id,action,previous_value,new_value,request_id)
         VALUES($1,$2,'doctor.approval.changed',$3,$4,$5)`,
        [actorUserId, doctorId, current.rows[0].approval_status, status, requestId]
      );
      const availability = await listSlots(client, result.rows[0]!.id);
      await client.query("COMMIT");
      return mapDoctor(result.rows[0]!, availability);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  async replaceAvailability(userId: string, slots: Array<{ startsAt: string; endsAt: string }>): Promise<DoctorAvailability[]> {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query<{ id: string }>("SELECT id FROM doctors WHERE user_id=$1 FOR UPDATE", [userId]);
      if (!rows[0]) {
        await client.query("ROLLBACK");
        return [];
      }
      const doctorId = rows[0].id;
      await client.query("DELETE FROM doctor_availability WHERE doctor_id=$1 AND starts_at > now()", [doctorId]);
      for (const slot of slots) {
        await client.query("INSERT INTO doctor_availability (doctor_id, starts_at, ends_at) VALUES ($1,$2,$3)", [doctorId, slot.startsAt, slot.endsAt]);
      }
      await client.query("COMMIT");
      return listSlots(client, doctorId);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }
}
