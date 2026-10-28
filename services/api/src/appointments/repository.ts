import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { Appointment, AppointmentRepository, AppointmentStatus, AvailableSlot } from "./types.js";
import { queueAppointmentNotifications } from "../notifications/events.js";

interface AppointmentRow { id: string; patient_id: string; doctor_id: string; starts_at: Date; ends_at: Date; status: AppointmentStatus; patient_display_name: string; doctor_display_name: string; specialization: string; appointment_type: "in_person" | "video"; scheduling_note: string | null; doctor_is_synthetic: boolean; }
function mapAppointment(row: AppointmentRow): Appointment { return { id: row.id, patientId: row.patient_id, doctorId: row.doctor_id, startsAt: row.starts_at.toISOString(), endsAt: row.ends_at.toISOString(), status: row.status, patientDisplayName: row.patient_display_name, doctorDisplayName: row.doctor_display_name, specialization: row.specialization, type: row.appointment_type, schedulingNote: row.scheduling_note, doctorIsSynthetic: row.doctor_is_synthetic }; }
const selectAppointment = `SELECT a.id, a.patient_id, a.doctor_id, a.starts_at, a.ends_at, a.status,
  p.given_name || ' ' || p.family_name AS patient_display_name,
  d.given_name || ' ' || d.family_name AS doctor_display_name, d.specialization,
  a.appointment_type,a.scheduling_note,d.is_synthetic AS doctor_is_synthetic
  FROM appointments a JOIN patients p ON p.user_id=a.patient_id JOIN doctors d ON d.id=a.doctor_id`;

export class PostgresAppointmentRepository implements AppointmentRepository {
  constructor(private readonly db: Pool, private readonly allowSynthetic = true) {}

  async listAvailableSlots(doctorId: string, from: string, to: string, type?: "in_person" | "video"): Promise<AvailableSlot[]> {
    const { rows } = await this.db.query<{ starts_at: Date; ends_at: Date }>(
      `SELECT av.starts_at, av.ends_at FROM doctor_availability av
       JOIN doctors d ON d.id=av.doctor_id AND d.approval_status='approved' AND d.accepting_appointments=true AND (d.is_synthetic=true OR d.license_status='verified')
       WHERE av.doctor_id=$1 AND av.starts_at >= $2 AND av.ends_at <= $3
         AND ($4::text IS NULL OR d.consultation_modes @> ARRAY[$4]::text[])
         AND ($5::boolean OR d.is_synthetic=false)
         AND NOT EXISTS (SELECT 1 FROM appointments a WHERE a.doctor_id=av.doctor_id AND a.status IN ('booked','confirmed')
           AND tstzrange(a.starts_at,a.ends_at,'[)') && tstzrange(av.starts_at,av.ends_at,'[)'))
       ORDER BY av.starts_at LIMIT 200`, [doctorId, from, to, type ?? null, this.allowSynthetic]
    );
    return rows.map((row) => ({ startsAt: row.starts_at.toISOString(), endsAt: row.ends_at.toISOString() }));
  }

  async create(patientId: string, doctorId: string, startsAt: string, endsAt: string, actorId: string, type: "in_person" | "video" = "in_person"): Promise<Appointment> {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const { rows: patientProfile } = await client.query("SELECT user_id FROM patients WHERE user_id=$1 FOR UPDATE", [patientId]);
      if (!patientProfile[0]) throw Object.assign(new Error("patient profile required"), { code: "PATIENT_PROFILE_REQUIRED" });
      const { rows: available } = await client.query(
        `SELECT av.id FROM doctor_availability av JOIN doctors d ON d.id=av.doctor_id
         WHERE av.doctor_id=$1 AND d.approval_status='approved' AND d.accepting_appointments=true AND (d.is_synthetic=true OR d.license_status='verified')
           AND d.consultation_modes @> ARRAY[$4]::text[]
           AND ($5::boolean OR d.is_synthetic=false)
           AND av.starts_at <= $2 AND av.ends_at >= $3 FOR UPDATE OF av, d`,
        [doctorId, startsAt, endsAt, type, this.allowSynthetic]
      );
      if (!available[0]) {
        const { rows: doctorRows } = await client.query<{ approval_status: string; accepting_appointments: boolean; consultation_modes: string[]; is_synthetic: boolean }>("SELECT approval_status, accepting_appointments, consultation_modes, is_synthetic FROM doctors WHERE id=$1", [doctorId]);
        if (doctorRows[0] && (doctorRows[0].approval_status !== "approved" || !doctorRows[0].accepting_appointments)) throw Object.assign(new Error("doctor is not approved"), { code: "DOCTOR_NOT_APPROVED" });
        if (doctorRows[0]?.is_synthetic && !this.allowSynthetic) throw Object.assign(new Error("synthetic profiles are disabled"), { code: "DOCTOR_NOT_APPROVED" });
        if (doctorRows[0] && !doctorRows[0].consultation_modes.includes(type)) throw Object.assign(new Error("consultation mode is unavailable"), { code: "CONSULTATION_MODE_UNAVAILABLE" });
        throw Object.assign(new Error("slot unavailable"), { code: "SLOT_UNAVAILABLE" });
      }
      const { rows: existing } = await client.query("SELECT id FROM appointments WHERE patient_id=$1 AND status IN ('booked','confirmed') AND tstzrange(starts_at,ends_at,'[)') && tstzrange($2::timestamptz,$3::timestamptz,'[)') FOR UPDATE", [patientId, startsAt, endsAt]);
      if (existing[0]) throw Object.assign(new Error("patient conflict"), { code: "23P01" });
      const insert = await client.query<{ id: string }>(
        `INSERT INTO appointments (patient_id,doctor_id,starts_at,ends_at,status,created_by,appointment_type)
         VALUES ($1,$2,$3,$4,'booked',$5,$6) RETURNING id`, [patientId, doctorId, startsAt, endsAt, actorId, type]
      );
      await client.query("INSERT INTO appointment_status_history (appointment_id,actor_user_id,from_status,to_status) VALUES ($1,$2,NULL,'booked')", [insert.rows[0]!.id, actorId]);
      if (type === "video") {
        await client.query(
          "INSERT INTO teleconsultations(appointment_id,room_name) VALUES($1,$2)",
          [insert.rows[0]!.id, `consult-${randomUUID().replaceAll("-", "")}`]
        );
      }
      await this.writeNotifications(client, insert.rows[0]!.id, "created");
      await client.query("COMMIT");
      return this.getById(this.db, insert.rows[0]!.id);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  async listForPatient(patientId: string, from?: string, to?: string): Promise<Appointment[]> {
    const { rows } = await this.db.query<AppointmentRow>(`${selectAppointment} WHERE a.patient_id=$1 AND ($2::timestamptz IS NULL OR a.starts_at >= $2) AND ($3::timestamptz IS NULL OR a.starts_at < $3) ORDER BY a.starts_at`, [patientId, from ?? null, to ?? null]);
    return rows.map(mapAppointment);
  }

  async listForDoctor(doctorId: string, from?: string, to?: string): Promise<Appointment[]> {
    const { rows } = await this.db.query<AppointmentRow>(`${selectAppointment} WHERE a.doctor_id=$1 AND ($2::timestamptz IS NULL OR a.starts_at >= $2) AND ($3::timestamptz IS NULL OR a.starts_at < $3) ORDER BY a.starts_at`, [doctorId, from ?? null, to ?? null]);
    return rows.map(mapAppointment);
  }

  async findDoctorIdByUserId(userId: string) { const { rows } = await this.db.query<{ id: string }>("SELECT id FROM doctors WHERE user_id=$1", [userId]); return rows[0]?.id; }

  async findForActor(id: string, actorId: string, role: "Patient" | "Doctor" | "Admin"): Promise<Appointment | undefined> {
    const predicate = role === "Patient" ? "a.patient_id=$2" : role === "Doctor" ? "d.user_id=$2" : "TRUE";
    const { rows } = await this.db.query<AppointmentRow>(`${selectAppointment} WHERE a.id=$1 AND ${predicate}`, [id, actorId]);
    return rows[0] && mapAppointment(rows[0]);
  }

  async findById(id: string): Promise<Appointment | undefined> {
    const { rows } = await this.db.query<AppointmentRow>(`${selectAppointment} WHERE a.id=$1`, [id]);
    return rows[0] && mapAppointment(rows[0]);
  }

  async hasCareRelationship(doctorId: string, patientId: string): Promise<boolean> {
    const { rowCount } = await this.db.query("SELECT 1 FROM appointments WHERE doctor_id=$1 AND patient_id=$2 AND status IN ('confirmed','completed') LIMIT 1", [doctorId, patientId]);
    return (rowCount ?? 0) > 0;
  }

  async cancel(id: string, actorId: string, role: "Patient" | "Doctor", reason?: string): Promise<Appointment | undefined> {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const predicate = role === "Patient" ? "patient_id=$2" : "doctor_id=(SELECT id FROM doctors WHERE user_id=$2)";
      const { rows } = await client.query<{ status: AppointmentStatus }>(`SELECT status FROM appointments WHERE id=$1 AND ${predicate} FOR UPDATE`, [id, actorId]);
      if (!rows[0] || !["booked", "confirmed"].includes(rows[0].status)) { await client.query("ROLLBACK"); return undefined; }
      const previous = rows[0].status;
      await client.query("UPDATE appointments SET status='cancelled', cancelled_by=$2, cancellation_reason=$3, updated_at=now() WHERE id=$1", [id, actorId, reason ?? null]);
      await client.query("INSERT INTO appointment_status_history (appointment_id,actor_user_id,from_status,to_status) VALUES ($1,$2,$3,'cancelled')", [id, actorId, previous]);
      await this.writeNotifications(client, id, "cancelled");
      await client.query("COMMIT");
      return this.getById(this.db, id);
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }

  async transition(id: string, actorId: string, nextStatus: AppointmentStatus): Promise<Appointment | undefined> {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query<{ status: AppointmentStatus }>("SELECT status FROM appointments WHERE id=$1 AND doctor_id=(SELECT id FROM doctors WHERE user_id=$2) FOR UPDATE", [id, actorId]);
      if (!rows[0]) { await client.query("ROLLBACK"); return undefined; }
      const previous = rows[0].status;
      const allowed: Record<AppointmentStatus, AppointmentStatus[]> = {
        booked: ["confirmed"], confirmed: ["completed", "no_show"], cancelled: [], completed: [], no_show: []
      };
      if (!allowed[previous].includes(nextStatus)) { await client.query("ROLLBACK"); return undefined; }
      const updated = await client.query("UPDATE appointments SET status=$2, updated_at=now() WHERE id=$1 RETURNING id", [id, nextStatus]);
      if (!updated.rows[0]) { await client.query("ROLLBACK"); return undefined; }
      await client.query("INSERT INTO appointment_status_history (appointment_id,actor_user_id,from_status,to_status) VALUES ($1,$2,$3,$4)", [id, actorId, previous, nextStatus]);
      await this.writeNotifications(client, id, "status_changed", `${previous}-${nextStatus}`);
      await client.query("COMMIT");
      return this.getById(this.db, id);
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }

  private async getById(db: Pool | PoolClient, id: string): Promise<Appointment> {
    const { rows } = await db.query<AppointmentRow>(`${selectAppointment} WHERE a.id=$1`, [id]);
    return mapAppointment(rows[0]!);
  }

  private async writeNotifications(client: PoolClient, appointmentId: string, eventType: "created" | "cancelled" | "status_changed", eventDetail?: string) {
    await queueAppointmentNotifications(client, appointmentId, eventType, eventDetail);
  }
}
