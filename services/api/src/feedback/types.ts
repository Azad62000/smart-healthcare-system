export interface PatientFeedback {
  id: string;
  appointmentId: string;
  rating: number;
  comment: string;
  createdAt: string;
}

export interface DoctorFeedback {
  id: string;
  appointmentId: string;
  rating: number;
  comment: string;
  createdAt: string;
  appointmentStartsAt: string;
}

export interface FeedbackRepository {
  listForPatient(patientId: string): Promise<PatientFeedback[]>;
  listForDoctor(doctorUserId: string): Promise<DoctorFeedback[]>;
  appointmentStatusForPatient(appointmentId: string, patientId: string): Promise<string | undefined>;
  create(patientId: string, appointmentId: string, rating: number, comment: string): Promise<PatientFeedback | undefined>;
}
