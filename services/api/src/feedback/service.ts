import { ApiRequestError } from "../request-error.js";
import type { FeedbackRepository } from "./types.js";

export class FeedbackService {
  constructor(private readonly repository: FeedbackRepository) {}

  listForPatient(patientId: string) { return this.repository.listForPatient(patientId); }
  listForDoctor(doctorUserId: string) { return this.repository.listForDoctor(doctorUserId); }

  async submit(patientId: string, appointmentId: string, rating: number, comment: string) {
    const status = await this.repository.appointmentStatusForPatient(appointmentId, patientId);
    if (!status) throw new ApiRequestError(404, "APPOINTMENT_NOT_FOUND", "Appointment was not found.");
    if (status !== "completed") throw new ApiRequestError(409, "APPOINTMENT_NOT_COMPLETED", "Feedback is available after the appointment is completed.");
    const feedback = await this.repository.create(patientId, appointmentId, rating, comment);
    if (!feedback) throw new ApiRequestError(409, "FEEDBACK_ALREADY_SUBMITTED", "Feedback has already been submitted for this appointment.");
    return feedback;
  }
}
