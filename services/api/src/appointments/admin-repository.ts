import { randomBytes } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { Appointment, AppointmentStatus } from "./types.js";
import { queueAppointmentNotifications } from "../notifications/events.js";

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
export interface DoctorScheduleCheck {
  id: string; name: string; email: string; specialization: string; qualification: string | null;
  experienceYears: number | null; city: string | null; consultationFeeInr: number | null;
  available: boolean; unavailableReason: "not_accepting" | "outside_availability" | "already_booked" | null;
  conflicts: Array<{ startsAt: string; endsAt: string; patientName: string }>;
}
export interface ScheduleFilters {
  startsAt: string; endsAt: string; type: AppointmentType; specialization?: string; city?: string;
  minimumExperience?: number; maximumFee?: number;
}
export type AdminAppointmentView = "all" | "pending" | "upcoming";
export interface AdminAppointmentListFilters {
  page: number; pageSize: number; view: AdminAppointmentView; status?: AppointmentStatus; from?: string; to?: string;
}
export interface AdminAppointmentPage {
  appointments: AdminAppointment[]; pagination: { page: number; pageSize: number; total: number; totalPages: number };
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
  checkDoctorAvailability(filters: ScheduleFilters): Promise<DoctorScheduleCheck[]>;
  list(filters: AdminAppointmentListFilters): Promise<AdminAppointmentPage>;
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
        WHERE u.status='active' AND d.approval_status='approved' AND (d.is_synthetic=true OR d.license_status='verified')
          AND ($1::boolean OR d.is_synthetic=false) ORDER BY name LIMIT 500`,
        [this.allowSynthetic]
      )
    ]);
    return { patients: patients.rows, doctors: doctors.rows };
  }

  async checkDoctorAvailability(filters: ScheduleFilters): Promise<DoctorScheduleCheck[]> {
    const { rows } = await this.db.query<{
      id: string; name: string; email: string; specialization: string; qualification: string | null;
      experience_years: number | null; city: string | null; consultation_fee_inr: number | null;
      accepting_appointments: boolean; has_availability: boolean; conflicts: Array<{ startsAt: string; endsAt: string; patientName: string }> | null;
    }>(
      `SELECT d.id,d.given_name || ' ' || d.family_name AS name,u.email,d.specialization,d.qualification,
         d.experience_years,d.city,d.consultation_fee_inr,d.accepting_appointments,
         EXISTS(SELECT 1 FROM doctor_availability av WHERE av.doctor_id=d.id AND av.starts_at<=$1 AND av.ends_at>=$2) AS has_availability,
         COALESCE((SELECT json_agg(json_build_object(
           'startsAt',a.starts_at,'endsAt',a.ends_at,'patientName',p.given_name || ' ' || p.family_name
         ) ORDER BY a.starts_at)
           FROM appointments a JOIN patients p ON p.user_id=a.patient_id
           WHERE a.doctor_id=d.id AND a.status IN ('booked','confirmed')
             AND tstzrange(a.starts_at,a.ends_at,'[)') && tstzrange($1::timestamptz,$2::timestamptz,'[)')), '[]'::json) AS conflicts
       FROM doctors d JOIN users u ON u.id=d.user_id
       WHERE u.role='Doctor' AND u.status='active' AND d.approval_status='approved' AND (d.is_synthetic=true OR d.license_status='verified')
         AND ($8::boolean OR d.is_synthetic=false)
         AND d.consultation_modes @> ARRAY[$3::text]
         AND ($4::text IS NULL OR d.specialization ILIKE '%' || $4 || '%')
         AND ($5::text IS NULL OR d.city ILIKE '%' || $5 || '%')
         AND ($6::integer IS NULL OR d.experience_years >= $6)
         AND ($7::integer IS NULL OR d.consultation_fee_inr <= $7)
       ORDER BY d.specialization,d.family_name,d.given_name LIMIT 500`,
      [filters.startsAt, filters.endsAt, filters.type, filters.specialization ?? null, filters.city ?? null,
        filters.minimumExperience ?? null, filters.maximumFee ?? null, this.allowSynthetic]
    );
    return rows.map((row) => {
      const conflicts = row.conflicts ?? [];
      const unavailableReason = !row.accepting_appointments ? "not_accepting"
        : conflicts.length ? "already_booked"
          : !row.has_availability ? "outside_availability" : null;
      return {
        id: row.id, name: row.name, email: row.email, specialization: row.specialization,
        qualification: row.qualification, experienceYears: row.experience_years, city: row.city,
        consultationFeeInr: row.consultation_fee_inr, available: unavailableReason === null,
        unavailableReason, conflicts: conflicts.map((conflict) => ({
          startsAt: new Date(conflict.startsAt).toISOString(), endsAt: new Date(conflict.endsAt).toISOString(), patientName: conflict.patientName
        }))
      };
    });
  }

  async list(filters: AdminAppointmentListFilters): Promise<AdminAppointmentPage> {
    const values = [filters.status ?? null, filters.view, filters.from ?? null, filters.to ?? null];
    const condition = `WHERE ($1::text IS NULL OR a.status=$1)
      AND ($2::text <> 'pending' OR (a.status='booked' AND a.starts_at>=now()))
      AND ($2::text <> 'upcoming' OR (a.status IN ('booked','confirmed') AND a.starts_at>=now()))
      AND ($3::timestamptz IS NULL OR a.starts_at >= $3)
      AND ($4::timestamptz IS NULL OR a.starts_at < $4)`;
    const [countResult, result] = await Promise.all([
      this.db.query<{ count: string }>(`SELECT count(*)::text AS count FROM appointments a ${condition}`, values),
      this.db.query<AdminAppointmentRow>(`${selection} ${condition} ORDER BY a.starts_at DESC,a.id LIMIT $5 OFFSET $6`,
        [...values, filters.pageSize, (filters.page - 1) * filters.pageSize])
    ]);
    const total = Number(countResult.rows[0]?.count ?? 0);
    return { appointments: result.rows.map(mapRow), pagination: { page: filters.page, pageSize: filters.pageSize, total, totalPages: Math.ceil(total / filters.pageSize) } };
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
      const doctor = await client.query<{ id: string; accepting_appointments: boolean; consultation_modes: string[] }>(
        `SELECT d.id,d.accepting_appointments,d.consultation_modes FROM doctors d JOIN users u ON u.id=d.user_id
         WHERE d.id=$1 AND d.approval_status='approved' AND (d.is_synthetic=true OR d.license_status='verified') AND u.status='active' AND u.role='Doctor'
           AND ($2::boolean OR d.is_synthetic=false) FOR SHARE OF d,u`,
        [input.doctorId, this.allowSynthetic]
      );
      if (!patient.rows[0] || !doctor.rows[0]) {
        throw Object.assign(new Error("Schedule participants are not active and eligible."), { code: "SCHEDULING_PARTICIPANT_INVALID" });
      }
      if (!doctor.rows[0]!.accepting_appointments || !doctor.rows[0]!.consultation_modes.includes(input.type)) {
        throw Object.assign(new Error("Doctor is not accepting this appointment type."), { code: "DOCTOR_UNAVAILABLE" });
      }
      const doctorSlot = await client.query(
        "SELECT 1 FROM doctor_availability WHERE doctor_id=$1 AND starts_at<=$2 AND ends_at>=$3 LIMIT 1",
        [input.doctorId, input.startsAt, input.endsAt]
      );
      if (!doctorSlot.rows[0]) throw Object.assign(new Error("Requested time is outside the doctor's published availability."), { code: "DOCTOR_UNAVAILABLE" });
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
      const current = await client.query<{ status: AppointmentStatus; doctor_id: string; appointment_type: AppointmentType }>(
        "SELECT status,doctor_id,appointment_type FROM appointments WHERE id=$1 FOR UPDATE",
        [id]
      );
      if (!current.rows[0] || !["booked", "confirmed"].includes(current.rows[0].status)) {
        await client.query("ROLLBACK");
        return undefined;
      }
      const doctor = await client.query<{ accepting_appointments: boolean; consultation_modes: string[] }>(
        "SELECT accepting_appointments,consultation_modes FROM doctors WHERE id=$1 FOR SHARE",
        [current.rows[0].doctor_id]
      );
      const doctorSlot = await client.query(
        "SELECT 1 FROM doctor_availability WHERE doctor_id=$1 AND starts_at<=$2 AND ends_at>=$3 LIMIT 1",
        [current.rows[0].doctor_id, startsAt, endsAt]
      );
      if (!doctorSlot.rows[0] || !doctor.rows[0]?.accepting_appointments || !doctor.rows[0].consultation_modes.includes(current.rows[0].appointment_type)) {
        throw Object.assign(new Error("Requested time is outside the doctor's published availability."), { code: "DOCTOR_UNAVAILABLE" });
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
    await queueAppointmentNotifications(client, appointmentId, type, detail, true);
  }
}
