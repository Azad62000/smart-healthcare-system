export type AppointmentStatusCount = {
  status: "booked" | "confirmed" | "cancelled" | "completed" | "no_show";
  count: number;
};

export interface AnalyticsOverview {
  patientCount: number;
  approvedDoctorCount: number;
  appointmentCount: number;
  appointmentsByStatus: AppointmentStatusCount[];
  pendingAppointmentCount: number;
  upcomingAppointmentCount: number;
  generatedAt: string;
}

export interface AnalyticsRepository {
  getOverview(now: Date): Promise<AnalyticsOverview>;
}
