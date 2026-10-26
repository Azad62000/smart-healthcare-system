import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import DoctorFeedbackPage from "./page";

describe("doctor feedback inbox", () => {
  beforeEach(() => vi.restoreAllMocks());
  it("shows feedback returned by the doctor-scoped endpoint", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { feedback: [{ id: "f1", appointmentId: "a1", rating: 4, comment: "Clear explanation.", createdAt: "2030-01-01T11:00:00Z", appointmentStartsAt: "2030-01-01T10:00:00Z" }] } }) }));
    render(<DoctorFeedbackPage />);
    expect(await screen.findByText("Clear explanation.")).toBeTruthy();
    expect(screen.getByLabelText("4 out of 5 stars")).toBeTruthy();
  });
});
