import type { Pool } from "pg";
import type { AnalyticsOverview, AnalyticsRepository, AppointmentStatusCount } from "./types.js";

type CountRow = { count: string };
type StatusRow = { status: AppointmentStatusCount["status"]; count: string };

function toCount(value: string | undefined): number {
  const count = Number(value ?? 0);
  return Number.isSafeInteger(count) && count >= 0 ? count : 0;
}

export class PostgresAnalyticsRepository implements AnalyticsRepository {
  constructor(private readonly db: Pool) {}

  async getOverview(now: Date): Promise<AnalyticsOverview> {
    const [patients, doctors, totalAppointments, byStatus, pending, upcoming] = await Promise.all([
      this.db.query<CountRow>("SELECT count(*)::text AS count FROM patients"),
      this.db.query<CountRow>("SELECT count(*)::text AS count FROM doctors WHERE approval_status='approved'"),
      this.db.query<CountRow>("SELECT count(*)::text AS count FROM appointments"),
      this.db.query<StatusRow>("SELECT status, count(*)::text AS count FROM appointments GROUP BY status ORDER BY status"),
      this.db.query<CountRow>("SELECT count(*)::text AS count FROM appointments WHERE status='booked' AND starts_at >= $1", [now.toISOString()]),
      this.db.query<CountRow>("SELECT count(*)::text AS count FROM appointments WHERE starts_at >= $1 AND status IN ('booked','confirmed')", [now.toISOString()])
    ]);
    return {
      patientCount: toCount(patients.rows[0]?.count),
      approvedDoctorCount: toCount(doctors.rows[0]?.count),
      appointmentCount: toCount(totalAppointments.rows[0]?.count),
      appointmentsByStatus: byStatus.rows.map(({ status, count }) => ({ status, count: toCount(count) })),
      pendingAppointmentCount: toCount(pending.rows[0]?.count),
      upcomingAppointmentCount: toCount(upcoming.rows[0]?.count),
      generatedAt: now.toISOString()
    };
  }
}
