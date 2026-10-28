import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { Prescription, PrescriptionInput, PrescriptionRepository } from "./types.js";
import { clinicalDataAdditionalData, MedicalDataCrypto } from "../medical-data-crypto.js";
import { queueEmailToUser } from "../notifications/events.js";

type PrescriptionRow = {
  id: string; patient_id: string; doctor_id: string; appointment_id: string;
  medication_name: string; dosage: string; route: string; frequency: string;
  duration_days: number; instructions: string | null; status: Prescription["status"];
  encryption_version: number; issued_at: Date; doctor_display_name: string;
};

const selectPrescription = `SELECT p.id, p.patient_id, p.doctor_id, p.appointment_id, p.medication_name,
  p.dosage, p.route, p.frequency, p.duration_days, p.instructions, p.status, p.encryption_version, p.issued_at,
  d.given_name || ' ' || d.family_name AS doctor_display_name
  FROM prescriptions p JOIN doctors d ON d.id=p.doctor_id`;

function mapPrescription(row: PrescriptionRow, crypto: MedicalDataCrypto): Prescription {
  const payload = row.encryption_version === 1
    ? JSON.parse(crypto.decryptText(row.medication_name, clinicalDataAdditionalData("prescription", row.id, row.patient_id, row.doctor_id), true)) as Pick<Prescription, "medicationName" | "dosage" | "route" | "frequency" | "durationDays" | "instructions">
    : { medicationName: row.medication_name, dosage: row.dosage, route: row.route, frequency: row.frequency, durationDays: row.duration_days, instructions: row.instructions };
  return {
    id: row.id, patientId: row.patient_id, doctorId: row.doctor_id, appointmentId: row.appointment_id,
    ...payload, status: row.status,
    issuedAt: row.issued_at.toISOString(), doctorDisplayName: row.doctor_display_name
  };
}

export class PostgresPrescriptionRepository implements PrescriptionRepository {
  constructor(private readonly db: Pool, private readonly crypto: MedicalDataCrypto) {}

  async listForPatient(patientId: string, actorId: string, requestId: string) {
    const { rows } = await this.db.query<PrescriptionRow>(`${selectPrescription} WHERE p.patient_id=$1 ORDER BY p.issued_at DESC LIMIT 100`, [patientId]);
    await this.db.query(
      "INSERT INTO prescription_access_events(actor_user_id,patient_id,action,request_id) VALUES($1,$2,'list',$3)",
      [actorId, patientId, requestId]
    );
    return rows.map((row) => mapPrescription(row, this.crypto));
  }

  async listForDoctor(doctorId: string, patientId: string, actorId: string, requestId: string) {
    const { rows } = await this.db.query<PrescriptionRow>(
      `${selectPrescription} WHERE p.doctor_id=$1 AND p.patient_id=$2 ORDER BY p.issued_at DESC LIMIT 100`,
      [doctorId, patientId]
    );
    await this.db.query(
      "INSERT INTO prescription_access_events(actor_user_id,patient_id,action,request_id) VALUES($1,$2,'list',$3)",
      [actorId, patientId, requestId]
    );
    return rows.map((row) => mapPrescription(row, this.crypto));
  }

  async create(doctorId: string, input: PrescriptionInput, actorId: string, requestId: string) {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const id = randomUUID();
      const payload = this.crypto.encryptText(JSON.stringify({ medicationName: input.medicationName, dosage: input.dosage, route: input.route, frequency: input.frequency, durationDays: input.durationDays, instructions: input.instructions }), clinicalDataAdditionalData("prescription", id, input.patientId, doctorId));
      await client.query(
        `INSERT INTO prescriptions(id,patient_id,doctor_id,appointment_id,medication_name,dosage,route,frequency,duration_days,instructions,encryption_version)
         VALUES($1,$2,$3,$4,$5,'encrypted','encrypted','encrypted',1,NULL,1) RETURNING id`,
        [id, input.patientId, doctorId, input.appointmentId, payload]
      );
      await client.query(
        "INSERT INTO prescription_access_events(actor_user_id,patient_id,prescription_id,action,request_id) VALUES($1,$2,$3,'create',$4)",
        [actorId, input.patientId, id, requestId]
      );
      await queueEmailToUser(client, input.patientId, `prescription:${id}`, "prescription_created", "A new prescription is available", "A new prescription is available in Smart Healthcare. Sign in to review it securely.");
      const result = await client.query<PrescriptionRow>(`${selectPrescription} WHERE p.id=$1`, [id]);
      await client.query("COMMIT");
      return mapPrescription(result.rows[0]!, this.crypto);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }
}
