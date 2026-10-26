import { ApiRequestError } from "../request-error.js";
import type { AppointmentRepository } from "../appointments/types.js";
import type { DoctorRepository } from "../doctors/types.js";
import type { ConsultationInput, RecordRepository } from "./types.js";

export class RecordService {
  constructor(private readonly records: RecordRepository, private readonly appointments: AppointmentRepository, private readonly doctors: DoctorRepository) {}

  async patientRecords(patientId: string, actorId: string, requestId: string) {
    const records = await this.records.listForPatient(patientId);
    await this.records.audit(actorId, patientId, null, "list", requestId);
    return records;
  }

  async patientRecord(recordId: string, patientId: string, actorId: string, requestId: string) {
    const record = await this.records.findForPatient(recordId, patientId);
    if (!record) throw new ApiRequestError(404, "RECORD_NOT_FOUND", "Health record was not found.");
    await this.records.audit(actorId, patientId, recordId, "read", requestId);
    return record;
  }

  async doctorRecords(doctorUserId: string, patientId: string | undefined, requestId: string) {
    const doctor = await this.doctors.findByUserId(doctorUserId);
    if (!doctor || doctor.approvalStatus !== "approved") throw new ApiRequestError(403, "FORBIDDEN", "An approved doctor profile is required.");
    if (patientId) await this.assertCareRelationship(doctor.id, patientId);
    const records = await this.records.listForDoctor(doctor.id, patientId);
    await Promise.all([...new Set(records.map((record) => record.patientId))].map((id) => this.records.audit(doctorUserId, id, null, "list", requestId)));
    return records;
  }

  async createDoctorRecord(doctorUserId: string, input: ConsultationInput, requestId: string) {
    const doctor = await this.doctors.findByUserId(doctorUserId);
    if (!doctor || doctor.approvalStatus !== "approved") throw new ApiRequestError(403, "FORBIDDEN", "An approved doctor profile is required.");
    await this.assertCareRelationship(doctor.id, input.patientId);
    if (input.appointmentId) {
      const appointment = await this.appointments.findById(input.appointmentId);
      if (!appointment || appointment.patientId !== input.patientId || appointment.doctorId !== doctor.id || !["confirmed", "completed"].includes(appointment.status)) {
        throw new ApiRequestError(400, "INVALID_APPOINTMENT_LINK", "The appointment is not a completed or confirmed appointment for this patient and doctor.");
      }
    }
    try { return await this.records.create(doctor.id, input, doctorUserId, requestId); }
    catch (error) {
      if ((error as { code?: string })?.code === "CARE_RELATIONSHIP_REQUIRED") {
        throw new ApiRequestError(input.appointmentId ? 400 : 403, input.appointmentId ? "INVALID_APPOINTMENT_LINK" : "FORBIDDEN", input.appointmentId ? "The appointment is not a confirmed or completed appointment for this patient and doctor." : "A care relationship is required to access this patient's records.");
      }
      throw error;
    }
  }

  private async assertCareRelationship(doctorId: string, patientId: string) {
    if (!(await this.appointments.hasCareRelationship(doctorId, patientId))) {
      throw new ApiRequestError(403, "FORBIDDEN", "A care relationship is required to access this patient's records.");
    }
  }
}
