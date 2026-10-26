import { ApiRequestError } from "../request-error.js";
import type { AppointmentRepository } from "../appointments/types.js";
import type { DoctorRepository } from "../doctors/types.js";
import type { PrescriptionInput, PrescriptionRepository } from "./types.js";

export class PrescriptionService {
  constructor(private readonly prescriptions: PrescriptionRepository, private readonly appointments: AppointmentRepository, private readonly doctors: DoctorRepository) {}

  listForPatient(patientId: string, requestId: string) {
    return this.prescriptions.listForPatient(patientId, patientId, requestId);
  }

  async listForDoctor(doctorUserId: string, patientId: string, requestId: string) {
    const doctor = await this.approvedDoctor(doctorUserId);
    if (!(await this.appointments.hasCareRelationship(doctor.id, patientId))) {
      throw new ApiRequestError(403, "FORBIDDEN", "A care relationship is required to access this patient's prescriptions.");
    }
    return this.prescriptions.listForDoctor(doctor.id, patientId, doctorUserId, requestId);
  }

  async create(doctorUserId: string, input: PrescriptionInput, requestId: string) {
    const doctor = await this.approvedDoctor(doctorUserId);
    const appointment = await this.appointments.findById(input.appointmentId);
    if (!appointment || appointment.patientId !== input.patientId || appointment.doctorId !== doctor.id ||
        !["confirmed", "completed"].includes(appointment.status)) {
      throw new ApiRequestError(400, "INVALID_APPOINTMENT_LINK", "A confirmed or completed appointment with this patient is required.");
    }
    return this.prescriptions.create(doctor.id, input, doctorUserId, requestId);
  }

  private async approvedDoctor(userId: string) {
    const doctor = await this.doctors.findByUserId(userId);
    if (!doctor || doctor.approvalStatus !== "approved") {
      throw new ApiRequestError(403, "FORBIDDEN", "An approved doctor profile is required.");
    }
    return doctor;
  }
}
