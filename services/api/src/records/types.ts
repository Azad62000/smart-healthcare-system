export interface ConsultationRecord {
  id: string;
  patientId: string;
  doctorId: string;
  appointmentId: string | null;
  consultationAt: string;
  note: string;
  diagnosis: string | null;
  doctorDisplayName: string;
  specialization: string;
  createdAt: string;
}

export interface ConsultationInput { patientId: string; appointmentId?: string | null; consultationAt?: string; note: string; diagnosis?: string | null; }

export interface RecordRepository {
  listForPatient(patientId: string): Promise<ConsultationRecord[]>;
  listForDoctor(doctorId: string, patientId?: string): Promise<ConsultationRecord[]>;
  findForPatient(recordId: string, patientId: string): Promise<ConsultationRecord | undefined>;
  create(doctorId: string, input: ConsultationInput, actorUserId: string, requestId: string): Promise<ConsultationRecord>;
  audit(actorUserId: string, patientId: string, recordId: string | null, action: "list" | "read" | "create", requestId: string): Promise<void>;
}
