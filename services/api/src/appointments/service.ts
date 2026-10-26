import { ApiRequestError } from "../request-error.js";
import type { AppointmentRepository, AppointmentStatus } from "./types.js";

const transitions: Record<AppointmentStatus, AppointmentStatus[]> = {
  booked: ["confirmed", "cancelled"],
  confirmed: ["completed", "no_show", "cancelled"],
  cancelled: [], completed: [], no_show: []
};

export class AppointmentService {
  constructor(private readonly repository: AppointmentRepository) {}

  available(doctorId: string, from: string, to: string, type?: "in_person" | "video") { return this.repository.listAvailableSlots(doctorId, from, to, type); }

  async book(patientId: string, doctorId: string, startsAt: string, endsAt: string, type: "in_person" | "video" = "in_person") {
    if (Date.parse(startsAt) <= Date.now()) throw new ApiRequestError(400, "INVALID_APPOINTMENT_TIME", "Appointments must be in the future.");
    if (Date.parse(endsAt) <= Date.parse(startsAt)) throw new ApiRequestError(400, "INVALID_APPOINTMENT_TIME", "End time must be after start time.");
    try { return await this.repository.create(patientId, doctorId, startsAt, endsAt, patientId, type); }
    catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "PATIENT_PROFILE_REQUIRED") throw new ApiRequestError(409, "PROFILE_REQUIRED", "Complete your patient profile before booking an appointment.");
      if (code === "DOCTOR_NOT_APPROVED") throw new ApiRequestError(409, "DOCTOR_NOT_APPROVED", "Appointments can only be booked with an approved doctor.");
      if (code === "CONSULTATION_MODE_UNAVAILABLE") throw new ApiRequestError(409, "CONSULTATION_MODE_UNAVAILABLE", "This doctor does not offer the selected consultation mode.");
      if (code === "SLOT_UNAVAILABLE" || code === "23P01" || code === "23505") throw new ApiRequestError(409, "SLOT_UNAVAILABLE", "This appointment time is no longer available.");
      throw error;
    }
  }

  listForPatient(patientId: string, from?: string, to?: string) { return this.repository.listForPatient(patientId, from, to); }

  async listForDoctor(userId: string, from?: string, to?: string) {
    const doctorId = await this.repository.findDoctorIdByUserId(userId);
    if (!doctorId) return [];
    return this.repository.listForDoctor(doctorId, from, to);
  }

  async cancel(id: string, actorId: string, role: "Patient" | "Doctor", reason?: string) {
    const appointment = await this.findActorAppointment(id, actorId, role);
    if (!appointment) throw new ApiRequestError(404, "APPOINTMENT_NOT_FOUND", "Appointment was not found.");
    if (!transitions[appointment.status].includes("cancelled")) throw new ApiRequestError(409, "INVALID_STATUS_TRANSITION", "This appointment cannot be cancelled in its current status.");
    const cancelled = await this.repository.cancel(id, actorId, role, reason);
    if (!cancelled) throw new ApiRequestError(409, "INVALID_STATUS_TRANSITION", "This appointment cannot be cancelled in its current status.");
    return cancelled;
  }

  async transition(id: string, actorId: string, role: "Doctor" | "Admin", nextStatus: AppointmentStatus) {
    const appointment = await this.findActorAppointment(id, actorId, role);
    if (!appointment) throw new ApiRequestError(404, "APPOINTMENT_NOT_FOUND", "Appointment was not found.");
    if (!transitions[appointment.status].includes(nextStatus)) throw new ApiRequestError(409, "INVALID_STATUS_TRANSITION", "This appointment status change is not allowed.");
    const updated = await this.repository.transition(id, actorId, nextStatus);
    if (!updated) throw new ApiRequestError(404, "APPOINTMENT_NOT_FOUND", "Appointment was not found.");
    return updated;
  }

  private async findActorAppointment(id: string, actorId: string, role: "Patient" | "Doctor" | "Admin") {
    return this.repository.findForActor(id, actorId, role);
  }
}
