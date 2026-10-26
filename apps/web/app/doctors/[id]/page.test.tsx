import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import DoctorProfilePage from "./page";

vi.mock("next/navigation", () => ({ useParams: () => ({ id: "doctor-123" }) }));

describe("doctor profile page", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("shows the mapped illustrative portrait, demo disclosure, and current booking path", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { doctor: {
        id: "doctor-123", givenName: "Anjali", familyName: "Malhotra", specialization: "Pediatrics",
        qualification: null, experienceYears: null, bio: null, isSynthetic: true,
        city: "Pune", availability: [], consultationModes: ["video"], consultationFeeInr: 500,
        ratingAverage: 4.7, ratingCount: 2400
      } } })
    }));
    const { container } = render(<DoctorProfilePage />);

    expect(await screen.findByRole("img", { name: "Illustration of fictional clinician Dr. Anjali Malhotra" })).toBeTruthy();
    expect(screen.getByText("Fictional clinician · not for real care")).toBeTruthy();
    expect(screen.getByLabelText("4.7 out of 5 stars from 2400 patient reviews")).toBeTruthy();
    expect(screen.getByText("2.4k reviews")).toBeTruthy();
    expect(container.querySelectorAll(".doctor-rating-stars .is-filled")).toHaveLength(5);
    expect(screen.getByRole("link", { name: "Patient appointments page" }).getAttribute("href")).toBe("/patient/appointments");
  });
});
