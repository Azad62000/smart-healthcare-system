import type { Pool } from "pg";
import type { Prescription, PrescriptionInput, PrescriptionRepository } from "./types.js";

type PrescriptionRow = {
  id: string; patient_id: string; doctor_id: string; appointment_id: string;
  medication_name: string; dosage: string; route: string; frequency: string;
  duration_days: number; instructions: string | null; status: Prescription["status"];
  issued_at: Date; doctor_display_name: string;
};

const selectPrescription = `SELECT p.id, p.patient_id, p.doctor_id, p.appointment_id, p.medication_name,
  p.dosage, p.route, p.frequency, p.duration_days, p.instructions, p.status, p.issued_at,
  d.given_name || ' ' || d.family_name AS doctor_display_name
  FROM prescriptions p JOIN doctors d ON d.id=p.doctor_id`;

function mapPrescription(row: PrescriptionRow): Prescription {
  return {
    id: row.id, patientId: row.patient_id, doctorId: row.doctor_id, appointmentId: row.appointment_id,
    medicationName: row.medication_name, dosage: row.dosage, route: row.route, frequency: row.frequency,
    durationDays: row.duration_days, instructions: row.instructions, status: row.status,
    issuedAt: row.issued_at.toISOString(), doctorDisplayName: row.doctor_display_name
  };
}

export class PostgresPrescriptionRepository implements PrescriptionRepository {
  constructor(private readonly db: Pool) {}

  async listForPatient(patientId: string, actorId: string, requestId: string) {
    const { rows } = await this.db.query<PrescriptionRow>(`${selectPrescription} WHERE p.patient_id=$1 ORDER BY p.issued_at DESC LIMIT 100`, [patientId]);
    await this.db.query(
      "INSERT INTO prescription_access_events(actor_user_id,patient_id,action,request_id) VALUES($1,$2,'list',$3)",
      [actorId, patientId, requestId]
    );
    return rows.map(mapPrescription);
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
    return rows.map(mapPrescription);
  }

  async create(doctorId: string, input: PrescriptionInput, actorId: string, requestId: string) {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO prescriptions(patient_id,doctor_id,appointment_id,medication_name,dosage,route,frequency,duration_days,instructions)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [input.patientId, doctorId, input.appointmentId, input.medicationName, input.dosage, input.route, input.frequency, input.durationDays, input.instructions]
      );
      const id = rows[0]!.id;
      await client.query(
        "INSERT INTO prescription_access_events(actor_user_id,patient_id,prescription_id,action,request_id) VALUES($1,$2,$3,'create',$4)",
        [actorId, input.patientId, id, requestId]
      );
      const result = await client.query<PrescriptionRow>(`${selectPrescription} WHERE p.id=$1`, [id]);
      await client.query("COMMIT");
      return mapPrescription(result.rows[0]!);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }
}
