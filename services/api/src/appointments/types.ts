export type AppointmentStatus = "booked" | "confirmed" | "cancelled" | "completed" | "no_show";
export interface Appointment {
  id: string; patientId: string; doctorId: string; startsAt: string; endsAt: string; status: AppointmentStatus;
  patientDisplayName: string; doctorDisplayName: string; specialization: string;
  type?: "in_person" | "video";
  schedulingNote?: string | null;
  doctorIsSynthetic?: boolean;
}
export interface AvailableSlot { startsAt: string; endsAt: string; }
export interface AppointmentRepository {
  listAvailableSlots(doctorId: string, from: string, to: string, type?: "in_person" | "video"): Promise<AvailableSlot[]>;
  create(patientId: string, doctorId: string, startsAt: string, endsAt: string, actorId: string, type?: "in_person" | "video"): Promise<Appointment>;
  listForPatient(patientId: string, from?: string, to?: string): Promise<Appointment[]>;
  listForDoctor(doctorId: string, from?: string, to?: string): Promise<Appointment[]>;
  findDoctorIdByUserId(userId: string): Promise<string | undefined>;
  findForActor(id: string, actorId: string, role: "Patient" | "Doctor" | "Admin"): Promise<Appointment | undefined>;
  findById(id: string): Promise<Appointment | undefined>;
  hasCareRelationship(doctorId: string, patientId: string): Promise<boolean>;
  cancel(id: string, actorId: string, role: "Patient" | "Doctor", reason?: string): Promise<Appointment | undefined>;
  transition(id: string, actorId: string, nextStatus: AppointmentStatus): Promise<Appointment | undefined>;
}
