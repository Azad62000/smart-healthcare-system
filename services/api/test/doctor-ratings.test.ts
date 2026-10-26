import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { PostgresDoctorRepository } from "../src/doctors/repository.js";

describe("public doctor rating summaries", () => {
  it("returns only persisted aggregate ratings with the approved directory profiles", async () => {
    const doctorRow = {
      id: "doctor-1", user_id: "user-1", given_name: "Sam", family_name: "Rivera", specialization: "Cardiology",
      qualification: "MD", experience_years: 8, bio: null, approval_status: "approved", created_at: new Date(), updated_at: new Date(),
      is_synthetic: false, city: "Pune", state: null, country: null, consultation_modes: ["in_person"], consultation_fee_inr: null,
      accepting_appointments: true, rating_average: "4.7", rating_count: 12
    };
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ available: true }] })
      .mockResolvedValueOnce({ rows: [doctorRow] })
      .mockResolvedValueOnce({ rows: [] });
    const repository = new PostgresDoctorRepository({ query } as unknown as Pool);

    const doctors = await repository.listApproved();
    expect(doctors[0]?.ratingAverage).toBe(4.7);
    expect(doctors[0]?.ratingCount).toBe(12);
    expect(String(query.mock.calls[1]?.[0])).toContain("appointment_feedback");
  });

  it("keeps the directory available before the feedback migration is applied", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ available: false }] })
      .mockResolvedValueOnce({ rows: [] });
    const repository = new PostgresDoctorRepository({ query } as unknown as Pool);

    expect(await repository.listApproved()).toEqual([]);
    expect(String(query.mock.calls[1]?.[0])).not.toContain("appointment_feedback");
  });
});
