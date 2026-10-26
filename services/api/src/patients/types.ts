export interface PatientProfile {
  userId: string;
  givenName: string;
  familyName: string;
  dateOfBirth: string;
  phone: string;
  addressLine: string | null;
  city: string | null;
  postalCode: string | null;
  createdAt: string;
  updatedAt: string;
}

export type PatientProfileInput = Pick<PatientProfile, "givenName" | "familyName" | "dateOfBirth" | "phone" | "addressLine" | "city" | "postalCode">;

export interface PatientRepository {
  findByUserId(userId: string): Promise<PatientProfile | undefined>;
  create(userId: string, profile: PatientProfileInput): Promise<PatientProfile>;
  update(userId: string, profile: PatientProfileInput): Promise<PatientProfile | undefined>;
}
