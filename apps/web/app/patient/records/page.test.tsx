import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import PatientRecordsPage from "./page";

describe("patient records page", () => {
  beforeEach(() => vi.restoreAllMocks());
  it("renders the patient's consultation records", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { records: [{ id: "r1", doctorDisplayName: "Doctor One", specialization: "Family Medicine", consultationAt: "2030-01-01T10:00:00Z", diagnosis: "Seasonal allergies", note: "Review in two weeks." }] } }) }));
    render(<PatientRecordsPage />);
    expect(await screen.findByRole("heading", { name: "Seasonal allergies" })).toBeTruthy();
    expect(screen.getByText("Review in two weeks.")).toBeTruthy();
  });
});
