import type { AppointmentRepository } from "../appointments/types.js";
import type { DoctorRepository, PublicDoctorProfile } from "../doctors/types.js";

export interface DoctorRecommendation {
  doctor: Omit<PublicDoctorProfile, "approvalStatus" | "availability" | "createdAt" | "updatedAt">;
  earliestAvailableSlot: { startsAt: string; endsAt: string };
  reasons: string[];
}

export interface RecommendationQuery {
  specialization?: string;
  city?: string;
  mode?: "video" | "in_person";
  maxFee?: number;
  from: string;
  to: string;
}

export class DoctorRecommendationService {
  constructor(private readonly doctors: DoctorRepository, private readonly appointments: AppointmentRepository) {}

  async recommend(query: RecommendationQuery): Promise<DoctorRecommendation[]> {
    const profiles = await this.doctors.listApproved(undefined, query);
    const results = await Promise.all(profiles.map(async (profile) => {
      if (profile.acceptingAppointments === false) return undefined;
      if (query.mode && !profile.consultationModes?.includes(query.mode)) return undefined;
      if (query.city && profile.city?.toLocaleLowerCase() !== query.city.toLocaleLowerCase()) return undefined;
      if (query.maxFee !== undefined && profile.consultationFeeInr !== null && profile.consultationFeeInr !== undefined && profile.consultationFeeInr > query.maxFee) return undefined;
      const slots = await this.appointments.listAvailableSlots(profile.id, query.from, query.to);
      if (!slots.length) return undefined;
      const earliest = slots.reduce((best, slot) => Date.parse(slot.startsAt) < Date.parse(best.startsAt) ? slot : best);
      const specializationMatch = query.specialization !== undefined
        && profile.specialization.localeCompare(query.specialization, undefined, { sensitivity: "accent" }) === 0;
      const doctor = {
        id: profile.id, givenName: profile.givenName, familyName: profile.familyName,
        specialization: profile.specialization, qualification: profile.qualification,
        experienceYears: profile.experienceYears, bio: profile.bio,
        isSynthetic: profile.isSynthetic ?? false,
        city: profile.city ?? null, state: profile.state ?? null, country: profile.country ?? null,
        consultationModes: profile.consultationModes ?? [],
        consultationFeeInr: profile.consultationFeeInr ?? null
      };
      const reasons = [
        ...(specializationMatch ? [`Matches requested specialization: ${profile.specialization}`] : []),
        ...(query.city ? [`Location match: ${profile.city}`] : []),
        ...(query.mode ? [`Offers ${query.mode === "video" ? "video" : "in-person"} consultation`] : []),
        ...(query.maxFee !== undefined && profile.consultationFeeInr !== null && profile.consultationFeeInr !== undefined ? [`Fee is within budget: INR ${profile.consultationFeeInr}`] : []),
        `Earliest available slot: ${earliest.startsAt}`,
        ...(profile.isSynthetic ? ["Synthetic demo profile; not a verified healthcare provider"] : [])
      ];
      return { doctor, earliestAvailableSlot: earliest, reasons, specializationMatch };
    }));

    return results.filter((result): result is NonNullable<typeof result> => result !== undefined)
      .sort((a, b) => Number(b.specializationMatch) - Number(a.specializationMatch)
        || Date.parse(a.earliestAvailableSlot.startsAt) - Date.parse(b.earliestAvailableSlot.startsAt)
        || a.doctor.id.localeCompare(b.doctor.id))
      .slice(0, 10)
      .map(({ specializationMatch: _match, ...result }) => result);
  }
}
