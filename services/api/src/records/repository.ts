import type { Pool, PoolClient } from "pg";
import type { ConsultationInput, ConsultationRecord, RecordRepository } from "./types.js";
import { randomUUID } from "node:crypto";
import { clinicalDataAdditionalData, MedicalDataCrypto } from "../medical-data-crypto.js";
import { queueEmailToUser } from "../notifications/events.js";

interface RecordRow { id: string; patient_id: string; doctor_id: string; appointment_id: string | null; consultation_at: Date; note: string; diagnosis: string | null; encryption_version: number; doctor_display_name: string; specialization: string; created_at: Date; }
const selectRecord = `SELECT r.id,r.patient_id,r.doctor_id,r.appointment_id,r.consultation_at,r.note,r.diagnosis,r.encryption_version,
 d.given_name || ' ' || d.family_name AS doctor_display_name,d.specialization,r.created_at
 FROM consultation_records r JOIN doctors d ON d.id=r.doctor_id`;
function mapRecord(row: RecordRow, crypto: MedicalDataCrypto): ConsultationRecord {
  const aad = clinicalDataAdditionalData("record", row.id, row.patient_id, row.doctor_id);
  const payload = row.encryption_version === 1
    ? JSON.parse(crypto.decryptText(row.note, aad, true)) as { note: string; diagnosis: string | null }
    : { note: row.note, diagnosis: row.diagnosis };
  return { id: row.id, patientId: row.patient_id, doctorId: row.doctor_id, appointmentId: row.appointment_id, consultationAt: row.consultation_at.toISOString(), note: payload.note, diagnosis: payload.diagnosis, doctorDisplayName: row.doctor_display_name, specialization: row.specialization, createdAt: row.created_at.toISOString() };
}

export class PostgresRecordRepository implements RecordRepository {
  constructor(private readonly db: Pool, private readonly crypto: MedicalDataCrypto) {}
  async listForPatient(patientId: string) {
    const { rows } = await this.db.query<RecordRow>(`${selectRecord} WHERE r.patient_id=$1 ORDER BY r.consultation_at DESC LIMIT 100`, [patientId]);
    return rows.map((row) => mapRecord(row, this.crypto));
  }
  async listForDoctor(doctorId: string, patientId?: string) {
    const { rows } = await this.db.query<RecordRow>(`${selectRecord} WHERE r.doctor_id=$1 AND ($2::uuid IS NULL OR r.patient_id=$2) ORDER BY r.consultation_at DESC LIMIT 100`, [doctorId, patientId ?? null]);
    return rows.map((row) => mapRecord(row, this.crypto));
  }
  async findForPatient(recordId: string, patientId: string) {
    const { rows } = await this.db.query<RecordRow>(`${selectRecord} WHERE r.id=$1 AND r.patient_id=$2`, [recordId, patientId]);
    return rows[0] && mapRecord(rows[0], this.crypto);
  }
  async create(doctorId: string, input: ConsultationInput, actorUserId: string, requestId: string) {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const relationship = await client.query<{ id: string }>(
        `SELECT id FROM appointments WHERE doctor_id=$1 AND patient_id=$2 AND status IN ('confirmed','completed')
         AND ($3::uuid IS NULL OR id=$3) LIMIT 1 FOR SHARE`,
        [doctorId, input.patientId, input.appointmentId ?? null]
      );
      if (!relationship.rows[0]) throw Object.assign(new Error("care relationship required"), { code: "CARE_RELATIONSHIP_REQUIRED" });
      const recordId = randomUUID();
      const aad = clinicalDataAdditionalData("record", recordId, input.patientId, doctorId);
      const encryptedPayload = this.crypto.encryptText(JSON.stringify({ note: input.note, diagnosis: input.diagnosis ?? null }), aad);
      await client.query(
        `INSERT INTO consultation_records(id,patient_id,doctor_id,appointment_id,consultation_at,note,diagnosis,encryption_version)
         VALUES($1,$2,$3,$4,COALESCE($5::timestamptz,now()),$6,NULL,1) RETURNING id`,
        [recordId, input.patientId, doctorId, input.appointmentId ?? null, input.consultationAt ?? null, encryptedPayload]
      );
      await client.query("INSERT INTO health_record_access_events(actor_user_id,patient_id,record_id,action,request_id) VALUES($1,$2,$3,'create',$4)", [actorUserId, input.patientId, recordId, requestId]);
      await queueEmailToUser(client, input.patientId, `health_record:${recordId}`, "health_record_created", "A new health record is available", "A new health record is available in Smart Healthcare. Sign in to review it securely.");
      const { rows: result } = await client.query<RecordRow>(`${selectRecord} WHERE r.id=$1`, [recordId]);
      await client.query("COMMIT");
      return mapRecord(result[0]!, this.crypto);
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }
  async audit(actorUserId: string, patientId: string, recordId: string | null, action: "list" | "read" | "create", requestId: string) {
    await this.db.query("INSERT INTO health_record_access_events(actor_user_id,patient_id,record_id,action,request_id) VALUES($1,$2,$3,$4,$5)", [actorUserId, patientId, recordId, action, requestId]);
  }
}
