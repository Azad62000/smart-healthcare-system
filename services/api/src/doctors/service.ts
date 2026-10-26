import { ApiRequestError } from "../request-error.js";
import type { DoctorApprovalStatus, DoctorProfileInput, DoctorRepository, PublicDoctorProfile } from "./types.js";

export class DoctorService {
  constructor(private readonly repository: DoctorRepository) {}
  async listDirectory(specialization?: string): Promise<PublicDoctorProfile[]> {
    return (await this.repository.listApproved(specialization)).map(({ userId: _userId, ...profile }) => profile);
  }
  async listPending(): Promise<PublicDoctorProfile[]> {
    return (await this.repository.listPending()).map(({ userId: _userId, ...profile }) => profile);
  }
  async getPublicProfile(id: string) {
    const profile = await this.repository.findPublicById(id);
    if (!profile) throw new ApiRequestError(404, "DOCTOR_NOT_FOUND", "Doctor profile was not found.");
    const { userId: _userId, ...publicProfile } = profile;
    return publicProfile satisfies PublicDoctorProfile;
  }
  getOwnProfile(userId: string) { return this.repository.findByUserId(userId); }
  saveOwnProfile(userId: string, profile: DoctorProfileInput) { return this.repository.saveProfile(userId, profile); }
  async updateAvailability(userId: string, slots: Array<{ startsAt: string; endsAt: string }>) {
    if (!(await this.repository.findByUserId(userId))) throw new ApiRequestError(409, "PROFILE_REQUIRED", "Complete your doctor profile before managing availability.");
    const availability = await this.repository.replaceAvailability(userId, slots);
    if (slots.length > 0 && availability.length === 0) throw new ApiRequestError(409, "PROFILE_REQUIRED", "Complete your doctor profile before managing availability.");
    return availability;
  }
  async setApprovalStatus(id: string, status: DoctorApprovalStatus, actorUserId: string, requestId: string) {
    const profile = await this.repository.setApprovalStatus(id, status, actorUserId, requestId);
    if (!profile) throw new ApiRequestError(404, "DOCTOR_NOT_FOUND", "Doctor profile was not found.");
    return profile;
  }
}
