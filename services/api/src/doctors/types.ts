export type DoctorApprovalStatus = "pending" | "approved" | "rejected" | "suspended";

export interface DoctorProfile {
  id: string;
  userId: string;
  givenName: string;
  familyName: string;
  specialization: string;
  qualification: string | null;
  experienceYears: number | null;
  bio: string | null;
  isSynthetic?: boolean;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  consultationModes?: Array<"video" | "in_person">;
  consultationFeeInr?: number | null;
  acceptingAppointments?: boolean;
  approvalStatus: DoctorApprovalStatus;
  availability: DoctorAvailability[];
  createdAt: string;
  updatedAt: string;
}

export type PublicDoctorProfile = Omit<DoctorProfile, "userId">;

export interface DoctorAvailability {
  id: string;
  startsAt: string;
  endsAt: string;
}

export type DoctorProfileInput = Pick<DoctorProfile, "givenName" | "familyName" | "specialization" | "qualification" | "experienceYears" | "bio">;

export interface DoctorRepository {
  listApproved(specialization?: string, filters?: { city?: string; mode?: "video" | "in_person"; maxFee?: number }): Promise<DoctorProfile[]>;
  listPending(): Promise<DoctorProfile[]>;
  findPublicById(id: string): Promise<DoctorProfile | undefined>;
  findByUserId(userId: string): Promise<DoctorProfile | undefined>;
  saveProfile(userId: string, profile: DoctorProfileInput): Promise<DoctorProfile>;
  setApprovalStatus(doctorId: string, status: DoctorApprovalStatus, actorUserId: string, requestId: string): Promise<DoctorProfile | undefined>;
  replaceAvailability(userId: string, slots: Array<{ startsAt: string; endsAt: string }>): Promise<DoctorAvailability[]>;
}
