import { z } from "zod";

const slotSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  day: z.string().min(1),
  start_time: z.string().regex(/^\d{2}:\d{2}$/),
  end_time: z.string().regex(/^\d{2}:\d{2}$/),
  timezone: z.string().min(1)
}).strict();

const doctorSchema = z.object({
  doctor_id: z.string().regex(/^DOC-DEMO-\d{3}$/),
  full_name: z.string().trim().min(1).max(161),
  specialization: z.string().trim().min(2).max(100),
  professional_title: z.string().trim().min(1).max(160),
  experience_years: z.number().int().min(0).max(60),
  city: z.string().trim().min(1).max(100),
  state: z.string().trim().min(1).max(100),
  country: z.string().trim().min(1).max(100),
  languages: z.array(z.string().min(1)),
  consultation_modes: z.array(z.enum(["Video", "in-person", "In-person"])).min(1),
  consultation_fee_inr: z.number().int().nonnegative(),
  availability_days: z.array(z.string()),
  availability_slots: z.array(slotSchema).min(1),
  profile_status: z.literal("synthetic_demo"),
  is_active: z.boolean(),
  accepting_appointments: z.boolean(),
  recommendation_notes: z.string(),
  email: z.string().email().refine((email) => email.endsWith("@example.test"))
}).strict();

const bundleSchema = z.object({
  dataset_type: z.literal("synthetic_demo_only"),
  record_count: z.literal(200),
  timezone: z.literal("Asia/Kolkata"),
  doctors: z.array(doctorSchema).length(200)
}).strict();

export type SyntheticDoctor = z.infer<typeof doctorSchema>;
export type SyntheticDoctorBundle = z.infer<typeof bundleSchema>;

export interface ImportedSyntheticDoctor {
  source: SyntheticDoctor;
  givenName: string;
  familyName: string;
  modes: Array<"video" | "in_person">;
  availability: Array<{ startsAt: string; endsAt: string }>;
}

export function assertSyntheticImportEnvironment(nodeEnvironment: string, databaseConnection: string): void {
  const url = new URL(databaseConnection);
  const databaseName = url.pathname.replace(/^\/+/, "");
  if (!["development", "test"].includes(nodeEnvironment) ||
      !["localhost", "127.0.0.1", "::1"].includes(url.hostname) ||
      databaseName !== "smart_healthcare") {
    throw new Error("Synthetic doctor import is restricted to a loopback smart_healthcare database in development or test.");
  }
}

function localTimeToUtc(date: string, time: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const calendarDate = new Date(Date.UTC(year!, month! - 1, day!));
  if (calendarDate.toISOString().slice(0, 10) !== date || hour! > 23 || minute! > 59) {
    throw new Error("Synthetic dataset contains an invalid availability date or time.");
  }
  const value = new Date(Date.UTC(year!, month! - 1, day!, hour!, minute!) - 330 * 60_000);
  return value;
}

export function validateSyntheticDoctorBundle(input: unknown): ImportedSyntheticDoctor[] {
  const bundle = bundleSchema.parse(input);
  const ids = new Set<string>();
  const emails = new Set<string>();
  return bundle.doctors.map((source) => {
    if (ids.has(source.doctor_id) || emails.has(source.email.toLowerCase())) {
      throw new Error("Synthetic dataset contains duplicate doctor IDs or email addresses.");
    }
    ids.add(source.doctor_id);
    emails.add(source.email.toLowerCase());
    const names = source.full_name.replace(/^Dr\.\s*/i, "").trim().split(/\s+/);
    if (names.length < 2) throw new Error("Synthetic dataset contains an invalid display name.");
    const availability = source.availability_slots.map((slot) => {
      if (slot.timezone !== bundle.timezone) throw new Error("Synthetic dataset contains an unsupported timezone.");
      const startsAt = localTimeToUtc(slot.date, slot.start_time);
      const endsAt = localTimeToUtc(slot.date, slot.end_time);
      if (endsAt <= startsAt) throw new Error("Synthetic dataset contains an invalid availability interval.");
      return { startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() };
    });
    const modes = [...new Set(source.consultation_modes.map((mode) => mode.toLowerCase() === "video" ? "video" as const : "in_person" as const))];
    return {
      source,
      givenName: names[0]!,
      familyName: names.slice(1).join(" "),
      modes,
      availability
    };
  });
}
