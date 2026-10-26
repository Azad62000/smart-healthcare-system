import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import DoctorDashboard from "./page";

describe("doctor dashboard", () => {
  beforeEach(() => vi.restoreAllMocks());
  it("shows approval, availability, and appointment empty states", async () => {
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/v1/notifications/me")) return Promise.resolve({ ok: true, json: async () => ({ data: { notifications: [] } }) });
      if (url.includes("/api/v1/doctors/me")) return Promise.resolve({ ok: true, json: async () => ({ data: { complete: true, profile: { id: "doctor-id", givenName: "Sam", familyName: "Rivera", specialization: "Cardiology", qualification: "MD", experienceYears: 8, bio: null, approvalStatus: "pending", availability: [] } } }) });
      if (url.includes("/api/v1/appointments/doctor/me")) return Promise.resolve({ ok: true, json: async () => ({ data: { appointments: [] } }) });
      throw new Error(`Unexpected test request: ${url}`);
    }));
    render(<DoctorDashboard />);
    expect(await screen.findByText("Approval pending")).toBeTruthy();
    expect(screen.getByText("No availability added")).toBeTruthy();
    expect(screen.getByText("No appointments yet")).toBeTruthy();
  });

  it("loads and creates a consultation record for an appointment patient", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/v1/notifications/me")) return Promise.resolve({ ok: true, json: async () => ({ data: { notifications: [] } }) });
      if (url.includes("/api/v1/doctors/me")) return Promise.resolve({ ok: true, json: async () => ({ data: { complete: true, profile: { id: "doctor-id", givenName: "Sam", familyName: "Rivera", specialization: "Cardiology", qualification: null, experienceYears: null, bio: null, approvalStatus: "approved", availability: [] } } }) });
      if (url.includes("/api/v1/appointments/doctor/me")) return Promise.resolve({ ok: true, json: async () => ({ data: { appointments: [{ id: "a1", patientId: "patient-id", patientDisplayName: "Patient One", startsAt: "2030-01-01T10:00:00Z", endsAt: "2030-01-01T10:30:00Z", status: "confirmed" }] } }) });
      if (url.includes("/api/v1/records/doctor?") && init?.method !== "POST") return Promise.resolve({ ok: true, json: async () => ({ data: { records: [] } }) });
      if (url.endsWith("/api/v1/records/doctor") && init?.method === "POST") return Promise.resolve({ ok: true, json: async () => ({ data: { record: { id: "r1", consultationAt: "2030-01-01T10:00:00Z", diagnosis: "Cold", note: "Rest." } } }) });
      throw new Error(`Unexpected test request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<DoctorDashboard />);
    fireEvent.change(await screen.findByLabelText("Patient"), { target: { value: "patient-id" } });
    await screen.findByText("No records yet");
    fireEvent.change(screen.getByLabelText("Diagnosis (optional)"), { target: { value: "Cold" } });
    fireEvent.change(screen.getByLabelText("Consultation note"), { target: { value: "Rest." } });
    fireEvent.click(screen.getByRole("button", { name: "Save consultation" }));
    expect(await screen.findByRole("status")).toBeTruthy();
  });
});
