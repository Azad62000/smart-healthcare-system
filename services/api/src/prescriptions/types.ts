export type PrescriptionStatus = "active" | "cancelled";

export interface Prescription {
  id: string;
  patientId: string;
  doctorId: string;
  appointmentId: string;
  medicationName: string;
  dosage: string;
  route: string;
  frequency: string;
  durationDays: number;
  instructions: string | null;
  status: PrescriptionStatus;
  issuedAt: string;
  doctorDisplayName: string;
}

export type PrescriptionInput = Pick<Prescription, "patientId" | "appointmentId" | "medicationName" | "dosage" | "route" | "frequency" | "durationDays" | "instructions">;

export interface PrescriptionRepository {
  listForPatient(patientId: string, actorId: string, requestId: string): Promise<Prescription[]>;
  listForDoctor(doctorId: string, patientId: string, actorId: string, requestId: string): Promise<Prescription[]>;
  create(doctorId: string, input: PrescriptionInput, actorId: string, requestId: string): Promise<Prescription>;
}
