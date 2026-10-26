import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import AdminDashboard from "./page";

describe("admin dashboard", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("loads pending doctors and removes an application after an Admin decision", async () => {
    const doctor = {
      id: "doctor-id",
      givenName: "Sam",
      familyName: "Rivera",
      specialization: "Cardiology",
      qualification: "MD",
      experienceYears: 8,
      bio: null,
      approvalStatus: "pending" as const
    };
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/v1/analytics/overview")) {
        return Promise.resolve({ ok: true, json: async () => ({ data: { overview: { patientCount: 2, approvedDoctorCount: 1, appointmentCount: 3, appointmentsByStatus: [], pendingAppointmentCount: 0, upcomingAppointmentCount: 0, generatedAt: "2030-01-01T00:00:00.000Z" } } }) });
      }
      if (url.endsWith("/api/v1/doctors/pending")) {
        return Promise.resolve({ ok: true, json: async () => ({ data: { doctors: [doctor] } }) });
      }
      if (url.endsWith("/api/v1/admin/users")) return Promise.resolve({ ok: true, json: async () => ({ data: { users: [] } }) });
      if (url.endsWith("/api/v1/admin/services")) return Promise.resolve({ ok: true, json: async () => ({ data: { services: [] } }) });
      if (url.endsWith("/api/v1/admin/appointments/options")) return Promise.resolve({ ok: true, json: async () => ({ data: { patients: [], doctors: [] } }) });
      if (url.endsWith("/api/v1/admin/appointments")) return Promise.resolve({ ok: true, json: async () => ({ data: { appointments: [] } }) });
      if (url.endsWith(`/api/v1/doctors/${doctor.id}/approval`) && init?.method === "PATCH") {
        expect(JSON.parse(String(init.body))).toEqual({ status: "approved" });
        return Promise.resolve({ ok: true, json: async () => ({ data: { profile: { ...doctor, approvalStatus: "approved" } } }) });
      }
      throw new Error(`Unexpected test request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AdminDashboard />);
    const card = await screen.findByRole("region", { name: "Pending doctor applications" });
    expect(within(card).getByText("Dr. Sam Rivera")).toBeTruthy();
    fireEvent.click(within(card).getByRole("button", { name: "Approve Dr. Sam Rivera" }));
    expect((await within(card).findByRole("status")).textContent).toContain("Sam Rivera was approved.");
    await waitFor(() => expect(within(card).queryByText("Dr. Sam Rivera")).toBeNull());
    expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith("/api/v1/doctors/doctor-id/approval") && init?.method === "PATCH")).toBe(true);
  });

  it("shows an empty state when there are no pending doctors", async () => {
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/v1/analytics/overview")) {
        return Promise.resolve({ ok: true, json: async () => ({ data: { overview: { patientCount: 0, approvedDoctorCount: 0, appointmentCount: 0, appointmentsByStatus: [], pendingAppointmentCount: 0, upcomingAppointmentCount: 0, generatedAt: "2030-01-01T00:00:00.000Z" } } }) });
      }
      if (url.endsWith("/api/v1/doctors/pending")) return Promise.resolve({ ok: true, json: async () => ({ data: { doctors: [] } }) });
      if (url.endsWith("/api/v1/admin/users")) return Promise.resolve({ ok: true, json: async () => ({ data: { users: [] } }) });
      if (url.endsWith("/api/v1/admin/services")) return Promise.resolve({ ok: true, json: async () => ({ data: { services: [] } }) });
      if (url.endsWith("/api/v1/admin/appointments/options")) return Promise.resolve({ ok: true, json: async () => ({ data: { patients: [], doctors: [] } }) });
      if (url.endsWith("/api/v1/admin/appointments")) return Promise.resolve({ ok: true, json: async () => ({ data: { appointments: [] } }) });
      throw new Error(`Unexpected test request: ${url}`);
    }));
    render(<AdminDashboard />);
    expect(await screen.findByText("No pending doctor applications.")).toBeTruthy();
  });
});
