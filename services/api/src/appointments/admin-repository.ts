import { randomBytes } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { Appointment, AppointmentStatus } from "./types.js";

export type AppointmentType = "in_person" | "video";
export interface ScheduleInput {
  patientId: string;
  doctorId: string;
  startsAt: string;
  endsAt: string;
  type: AppointmentType;
  schedulingNote: string | null;
  adminNote: string | null;
}
export interface ScheduleOption {
  id: string;
  name: string;
  email: string;
}
export interface AdminAppointment extends Appointment {
  type: AppointmentType;
  schedulingNote: string | null;
  adminNote: string | null;
  patientEmail: string;
  doctorEmail: string;
  roomName: string | null;
}
export interface AdminAppointmentRepository {
  listOptions(): Promise<{ patients: ScheduleOption[]; doctors: ScheduleOption[] }>;
  list(): Promise<AdminAppointment[]>;
  create(input: ScheduleInput, adminId: string): Promise<AdminAppointment>;
  reschedule(id: string, startsAt: string, endsAt: string, adminId: string): Promise<AdminAppointment | undefined>;
  cancel(id: string, adminId: string, reason: string | undefined): Promise<AdminAppointment | undefined>;
}

interface AdminAppointmentRow {
  id: string;
  patient_id: string;
  doctor_id: string;
  starts_at: Date;
  ends_at: Date;
  status: AppointmentStatus;
  patient_display_name: string;
  doctor_display_name: string;
  specialization: string;
  appointment_type: AppointmentType;
  scheduling_note: string | null;
  admin_note: string | null;
  patient_email: string;
  doctor_email: string;
  room_name: string | null;
}

const selection = `SELECT a.id,a.patient_id,a.doctor_id,a.starts_at,a.ends_at,a.status,
  p.given_name || ' ' || p.family_name AS patient_display_name,
  d.given_name || ' ' || d.family_name AS doctor_display_name,d.specialization,
  a.appointment_type,a.scheduling_note,a.admin_note,pu.email AS patient_email,du.email AS doctor_email,
  tc.room_name
  FROM appointments a
  JOIN patients p ON p.user_id=a.patient_id
  JOIN doctors d ON d.id=a.doctor_id
  JOIN users pu ON pu.id=a.patient_id
  JOIN users du ON du.id=d.user_id
  LEFT JOIN teleconsultations tc ON tc.appointment_id=a.id`;

function mapRow(row: AdminAppointmentRow): AdminAppointment {
  return {
    id: row.id,
    patientId: row.patient_id,
    doctorId: row.doctor_id,
    startsAt: row.starts_at.toISOString(),
    endsAt: row.ends_at.toISOString(),
    status: row.status,
    patientDisplayName: row.patient_display_name,
    doctorDisplayName: row.doctor_display_name,
    specialization: row.specialization,
    type: row.appointment_type,
    schedulingNote: row.scheduling_note,
    adminNote: row.admin_note,
    patientEmail: row.patient_email,
    doctorEmail: row.doctor_email,
    roomName: row.room_name
  };
}

export class PostgresAdminAppointmentRepository implements AdminAppointmentRepository {
  constructor(private readonly db: Pool, private readonly allowSynthetic = true) {}

  async listOptions(): Promise<{ patients: ScheduleOption[]; doctors: ScheduleOption[] }> {
    const [patients, doctors] = await Promise.all([
      this.db.query<{ id: string; name: string; email: string }>(
        `SELECT u.id,p.given_name || ' ' || p.family_name AS name,u.email
         FROM users u JOIN patients p ON p.user_id=u.id
         WHERE u.status='active' ORDER BY name LIMIT 500`
      ),
      this.db.query<{ id: string; name: string; email: string }>(
        `SELECT d.id,d.given_name || ' ' || d.family_name AS name,u.email
         FROM users u JOIN doctors d ON d.user_id=u.id
        WHERE u.status='active' AND d.approval_status='approved'
          AND ($1::boolean OR d.is_synthetic=false) ORDER BY name LIMIT 500`,
        [this.allowSynthetic]
      )
    ]);
    return { patients: patients.rows, doctors: doctors.rows };
  }

  async list(): Promise<AdminAppointment[]> {
    const { rows } = await this.db.query<AdminAppointmentRow>(`${selection} ORDER BY a.starts_at DESC LIMIT 500`);
    return rows.map(mapRow);
  }

  async create(input: ScheduleInput, adminId: string): Promise<AdminAppointment> {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const patient = await client.query<{ id: string }>(
        `SELECT u.id FROM users u JOIN patients p ON p.user_id=u.id
         WHERE u.id=$1 AND u.role='Patient' AND u.status='active' FOR SHARE OF u,p`,
        [input.patientId]
      );
      const doctor = await client.query<{ id: string }>(
        `SELECT d.id FROM doctors d JOIN users u ON u.id=d.user_id
         WHERE d.id=$1 AND d.approval_status='approved' AND u.status='active' AND u.role='Doctor'
           AND ($2::boolean OR d.is_synthetic=false) FOR SHARE OF d,u`,
        [input.doctorId, this.allowSynthetic]
      );
      if (!patient.rows[0] || !doctor.rows[0]) {
        throw Object.assign(new Error("Schedule participants are not active and eligible."), { code: "SCHEDULING_PARTICIPANT_INVALID" });
      }
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO appointments(patient_id,doctor_id,starts_at,ends_at,status,created_by,appointment_type,scheduling_note,admin_note)
         VALUES($1,$2,$3,$4,'confirmed',$5,$6,$7,$8) RETURNING id`,
        [input.patientId, input.doctorId, input.startsAt, input.endsAt, adminId, input.type, input.schedulingNote, input.adminNote]
      );
      const appointmentId = inserted.rows[0]!.id;
      await client.query(
        "INSERT INTO appointment_status_history(appointment_id,actor_user_id,from_status,to_status) VALUES($1,$2,NULL,'confirmed')",
        [appointmentId, adminId]
      );
      if (input.type === "video") {
        await client.query(
          `INSERT INTO teleconsultations(appointment_id,room_name)
           VALUES($1,$2)`,
          [appointmentId, `consult-${randomBytes(24).toString("hex")}`]
        );
      }
      await this.notify(client, appointmentId, "created", "");
      const result = await client.query<AdminAppointmentRow>(`${selection} WHERE a.id=$1`, [appointmentId]);
      await client.query("COMMIT");
      return mapRow(result.rows[0]!);
    } catch (error) {
      await client.query("ROLLBACK");
      if ((error as { code?: string }).code === "23P01") {
        throw Object.assign(new Error("A participant already has an appointment at that time."), { code: "APPOINTMENT_CONFLICT" });
      }
      throw error;
    } finally { client.release(); }
  }

  async reschedule(id: string, startsAt: string, endsAt: string, adminId: string): Promise<AdminAppointment | undefined> {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const current = await client.query<{ status: AppointmentStatus }>(
        "SELECT status FROM appointments WHERE id=$1 FOR UPDATE",
        [id]
      );
      if (!current.rows[0] || !["booked", "confirmed"].includes(current.rows[0].status)) {
        await client.query("ROLLBACK");
        return undefined;
      }
      await client.query("UPDATE appointments SET starts_at=$2,ends_at=$3,updated_at=now() WHERE id=$1", [id, startsAt, endsAt]);
      await client.query(
        "INSERT INTO appointment_status_history(appointment_id,actor_user_id,from_status,to_status) VALUES($1,$2,$3,$3)",
        [id, adminId, current.rows[0].status]
      );
      await this.notify(client, id, "status_changed", "rescheduled");
      const result = await client.query<AdminAppointmentRow>(`${selection} WHERE a.id=$1`, [id]);
      await client.query("COMMIT");
      return mapRow(result.rows[0]!);
    } catch (error) {
      await client.query("ROLLBACK");
      if ((error as { code?: string }).code === "23P01") {
        throw Object.assign(new Error("A participant already has an appointment at that time."), { code: "APPOINTMENT_CONFLICT" });
      }
      throw error;
    } finally { client.release(); }
  }

  async cancel(id: string, adminId: string, reason: string | undefined): Promise<AdminAppointment | undefined> {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const current = await client.query<{ status: AppointmentStatus }>(
        "SELECT status FROM appointments WHERE id=$1 FOR UPDATE",
        [id]
      );
      if (!current.rows[0] || !["booked", "confirmed"].includes(current.rows[0].status)) {
        await client.query("ROLLBACK");
        return undefined;
      }
      await client.query(
        "UPDATE appointments SET status='cancelled',cancelled_by=$2,cancellation_reason=$3,updated_at=now() WHERE id=$1",
        [id, adminId, reason ?? null]
      );
      await client.query(
        "INSERT INTO appointment_status_history(appointment_id,actor_user_id,from_status,to_status) VALUES($1,$2,$3,'cancelled')",
        [id, adminId, current.rows[0].status]
      );
      await client.query(
        "UPDATE teleconsultations SET status='cancelled',updated_at=now() WHERE appointment_id=$1",
        [id]
      );
      await this.notify(client, id, "cancelled", "");
      const result = await client.query<AdminAppointmentRow>(`${selection} WHERE a.id=$1`, [id]);
      await client.query("COMMIT");
      return mapRow(result.rows[0]!);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  private async notify(client: PoolClient, appointmentId: string, type: "created" | "cancelled" | "status_changed", detail: string): Promise<void> {
    const title = type === "created" ? "Appointment scheduled" : type === "cancelled" ? "Appointment cancelled" : "Appointment updated";
    const message = type === "created" ? "An appointment has been scheduled." : type === "cancelled" ? "An appointment has been cancelled." : "An appointment has been rescheduled.";
    await client.query(
      `INSERT INTO notifications(recipient_user_id,event_key,appointment_id,event_type,title,message)
       SELECT participant.user_id,$2 || ':' || a.id::text || ':' || $5,a.id,$2,$3,$4
       FROM appointments a
       CROSS JOIN LATERAL (VALUES(a.patient_id),((SELECT user_id FROM doctors WHERE id=a.doctor_id))) participant(user_id)
       WHERE a.id=$1 AND participant.user_id IS NOT NULL
       ON CONFLICT(recipient_user_id,event_key) DO NOTHING`,
      [appointmentId, type, title, message, detail]
    );
  }
}
