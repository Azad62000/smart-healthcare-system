import { ApiRequestError } from "../request-error.js";
import type { PatientProfileInput, PatientRepository } from "./types.js";

export class PatientService {
  constructor(private readonly repository: PatientRepository) {}

  getProfile(userId: string) { return this.repository.findByUserId(userId); }

  async saveProfile(userId: string, profile: PatientProfileInput) {
    const existing = await this.repository.findByUserId(userId);
    if (existing) {
      const updated = await this.repository.update(userId, profile);
      if (!updated) throw new ApiRequestError(404, "PROFILE_NOT_FOUND", "Patient profile was not found.");
      return updated;
    }
    return this.repository.create(userId, profile);
  }
}
