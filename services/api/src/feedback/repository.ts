import type { Pool } from "pg";
import type { DoctorFeedback, FeedbackRepository, PatientFeedback } from "./types.js";

interface FeedbackRow { id: string; appointment_id: string; rating: number; comment: string; created_at: Date; }
interface DoctorFeedbackRow extends FeedbackRow { starts_at: Date; }
function mapFeedback(row: FeedbackRow): PatientFeedback {
  return { id: row.id, appointmentId: row.appointment_id, rating: row.rating, comment: row.comment, createdAt: row.created_at.toISOString() };
}

export class PostgresFeedbackRepository implements FeedbackRepository {
  constructor(private readonly db: Pool) {}

  async listForPatient(patientId: string): Promise<PatientFeedback[]> {
    const { rows } = await this.db.query<FeedbackRow>(
      "SELECT id, appointment_id, rating, comment, created_at FROM appointment_feedback WHERE patient_id=$1 ORDER BY created_at DESC",
      [patientId]
    );
    return rows.map(mapFeedback);
  }

  async listForDoctor(doctorUserId: string): Promise<DoctorFeedback[]> {
    const { rows } = await this.db.query<DoctorFeedbackRow>(
      `SELECT f.id, f.appointment_id, f.rating, f.comment, f.created_at, a.starts_at
       FROM appointment_feedback f
       JOIN doctors d ON d.id=f.doctor_id
       JOIN appointments a ON a.id=f.appointment_id AND a.doctor_id=d.id
       WHERE d.user_id=$1
       ORDER BY f.created_at DESC
       LIMIT 100`,
      [doctorUserId]
    );
    return rows.map((row) => ({ ...mapFeedback(row), appointmentStartsAt: row.starts_at.toISOString() }));
  }

  async appointmentStatusForPatient(appointmentId: string, patientId: string): Promise<string | undefined> {
    const { rows } = await this.db.query<{ status: string }>(
      "SELECT status FROM appointments WHERE id=$1 AND patient_id=$2",
      [appointmentId, patientId]
    );
    return rows[0]?.status;
  }

  async create(patientId: string, appointmentId: string, rating: number, comment: string): Promise<PatientFeedback | undefined> {
    const { rows } = await this.db.query<FeedbackRow>(
      `INSERT INTO appointment_feedback (appointment_id, patient_id, doctor_id, rating, comment)
       SELECT a.id, a.patient_id, a.doctor_id, $3, $4
       FROM appointments a WHERE a.id=$1 AND a.patient_id=$2 AND a.status='completed'
       ON CONFLICT (appointment_id) DO NOTHING
       RETURNING id, appointment_id, rating, comment, created_at`,
      [appointmentId, patientId, rating, comment]
    );
    return rows[0] && mapFeedback(rows[0]);
  }
}
