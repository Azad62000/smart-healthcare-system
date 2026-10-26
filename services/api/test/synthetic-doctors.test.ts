import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  assertSyntheticImportEnvironment,
  validateSyntheticDoctorBundle
} from "../src/doctors/synthetic-dataset.js";

const datasetPath = resolve(dirname(fileURLToPath(import.meta.url)), "../seeds/data/synthetic_doctors_200.json");

describe("synthetic doctor dataset", () => {
  it("validates all 200 profiles and converts supplied Asia/Kolkata slots to UTC", async () => {
    const source = JSON.parse(await readFile(datasetPath, "utf8")) as unknown;
    const doctors = validateSyntheticDoctorBundle(source);
    expect(doctors).toHaveLength(200);
    expect(new Set(doctors.map((doctor) => doctor.source.doctor_id)).size).toBe(200);
    expect(doctors.every((doctor) => doctor.source.email.endsWith("@example.test"))).toBe(true);
    expect(doctors[0]!.availability[0]!.startsAt).toBe("2026-10-27T04:30:00.000Z");
    expect(doctors[0]!.source.availability_slots[0]!.day).toBe("Wednesday");
  });

  it("rejects duplicate IDs, malformed data, and unsupported import environments", async () => {
    const source = JSON.parse(await readFile(datasetPath, "utf8")) as { doctors: Array<Record<string, unknown>> };
    source.doctors[1]!.doctor_id = source.doctors[0]!.doctor_id;
    expect(() => validateSyntheticDoctorBundle(source)).toThrow(/duplicate/i);
    expect(() => assertSyntheticImportEnvironment("production", "postgresql://localhost:5432/smart_healthcare")).toThrow(/restricted/i);
    expect(() => assertSyntheticImportEnvironment("development", "postgresql://db.example.test:5432/smart_healthcare")).toThrow(/restricted/i);
    expect(() => assertSyntheticImportEnvironment("development", "postgresql://localhost:5432/other")).toThrow(/restricted/i);
    expect(() => assertSyntheticImportEnvironment("test", "postgresql://localhost:5432/smart_healthcare")).not.toThrow();
  });
});
