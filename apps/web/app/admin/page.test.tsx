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
      if (url.includes("/api/v1/admin/users")) return Promise.resolve({ ok: true, json: async () => ({ data: { users: [] } }) });
      if (url.endsWith("/api/v1/admin/services")) return Promise.resolve({ ok: true, json: async () => ({ data: { services: [] } }) });
      if (url.endsWith("/api/v1/admin/appointments/options")) return Promise.resolve({ ok: true, json: async () => ({ data: { patients: [], doctors: [] } }) });
      if (url.includes("/api/v1/admin/appointments?")) return Promise.resolve({ ok: true, json: async () => ({ data: { appointments: [] } }) });
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
      if (url.includes("/api/v1/admin/users")) return Promise.resolve({ ok: true, json: async () => ({ data: { users: [] } }) });
      if (url.endsWith("/api/v1/admin/services")) return Promise.resolve({ ok: true, json: async () => ({ data: { services: [] } }) });
      if (url.endsWith("/api/v1/admin/appointments/options")) return Promise.resolve({ ok: true, json: async () => ({ data: { patients: [], doctors: [] } }) });
      if (url.includes("/api/v1/admin/appointments?")) return Promise.resolve({ ok: true, json: async () => ({ data: { appointments: [] } }) });
      throw new Error(`Unexpected test request: ${url}`);
    }));
    render(<AdminDashboard />);
    expect(await screen.findByText("No pending doctor applications.")).toBeTruthy();
  });

  it("opens patient records from the registered-patients metric", async () => {
    const patient = { id: "patient-id", email: "patient@example.test", role: "Patient", status: "active", createdAt: "2030-01-01T00:00:00.000Z", patientProfileComplete: true };
    const secondPatient = { ...patient, id: "patient-two", email: "second.patient@example.test" };
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/v1/analytics/overview")) return Promise.resolve({ ok: true, json: async () => ({ data: { overview: { patientCount: 1, approvedDoctorCount: 0, appointmentCount: 0, appointmentsByStatus: [], pendingAppointmentCount: 0, upcomingAppointmentCount: 0, generatedAt: "2030-01-01T00:00:00.000Z" } } }) });
      if (url.endsWith("/api/v1/doctors/pending")) return Promise.resolve({ ok: true, json: async () => ({ data: { doctors: [] } }) });
      if (url.includes("/api/v1/admin/users?role=Patient")) {
        const page = Number(new URL(url).searchParams.get("page"));
        return Promise.resolve({ ok: true, json: async () => ({ data: { users: [page === 2 ? secondPatient : patient], pagination: { page, pageSize: 25, total: 26, totalPages: 2 } } }) });
      }
      if (url.includes("/api/v1/admin/users")) return Promise.resolve({ ok: true, json: async () => ({ data: { users: [] } }) });
      if (url.endsWith("/api/v1/admin/services")) return Promise.resolve({ ok: true, json: async () => ({ data: { services: [] } }) });
      if (url.endsWith("/api/v1/admin/appointments/options")) return Promise.resolve({ ok: true, json: async () => ({ data: { patients: [], doctors: [] } }) });
      if (url.includes("/api/v1/admin/appointments?")) return Promise.resolve({ ok: true, json: async () => ({ data: { appointments: [] } }) });
      throw new Error(`Unexpected test request: ${url}`);
    }));
    render(<AdminDashboard />);
    fireEvent.click(await screen.findByRole("button", { name: /PATIENTS/ }));
    expect(await screen.findByRole("heading", { name: "Registered patients" })).toBeTruthy();
    expect((await screen.findAllByText("patient@example.test")).length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole("button", { name: "Next" })[0]);
    const patientRecord = await screen.findAllByRole("button", { name: "second.patient@example.test" });
    fireEvent.click(patientRecord[0]);
    expect(await screen.findByRole("dialog", { name: "Patient account" })).toBeTruthy();
    expect(screen.getByText("Patient profile")).toBeTruthy();
  });

  it("filters doctors for a selected appointment time and shows booked conflicts", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/v1/analytics/overview")) return Promise.resolve({ ok: true, json: async () => ({ data: { overview: { patientCount: 0, approvedDoctorCount: 0, appointmentCount: 0, appointmentsByStatus: [], pendingAppointmentCount: 0, upcomingAppointmentCount: 0, generatedAt: "2030-01-01T00:00:00.000Z" } } }) });
      if (url.endsWith("/api/v1/doctors/pending")) return Promise.resolve({ ok: true, json: async () => ({ data: { doctors: [] } }) });
      if (url.includes("/api/v1/admin/users")) return Promise.resolve({ ok: true, json: async () => ({ data: { users: [] } }) });
      if (url.endsWith("/api/v1/admin/services")) return Promise.resolve({ ok: true, json: async () => ({ data: { services: [] } }) });
      if (url.endsWith("/api/v1/admin/appointments/options")) return Promise.resolve({ ok: true, json: async () => ({ data: { patients: [], doctors: [] } }) });
      if (url.includes("/api/v1/admin/appointments/availability?")) {
        const query = new URL(url).searchParams;
        expect(query.get("specialization")).toBe("Cardiology");
        expect(query.get("city")).toBe("Demo City");
        expect(query.get("minimumExperience")).toBe("5");
        expect(query.get("maximumFee")).toBe("1000");
        return Promise.resolve({ ok: true, json: async () => ({ data: { doctors: [
        { id: "free", name: "Free Doctor", email: "free@example.test", specialization: "Cardiology", experienceYears: 10, city: "Demo City", available: true, unavailableReason: null, conflicts: [] },
        { id: "busy", name: "Busy Doctor", email: "busy@example.test", specialization: "Cardiology", experienceYears: 12, city: "Demo City", available: false, unavailableReason: "already_booked", conflicts: [{ startsAt: "2031-05-20T10:00:00.000Z", endsAt: "2031-05-20T10:30:00.000Z", patientName: "Synthetic Patient" }] }
      ] } }) });
      }
      if (url.includes("/api/v1/admin/appointments?")) return Promise.resolve({ ok: true, json: async () => ({ data: { appointments: [] } }) });
      throw new Error(`Unexpected test request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<AdminDashboard />);
    fireEvent.change(await screen.findByLabelText("Start date and time"), { target: { value: "2031-05-20T10:00" } });
    fireEvent.change(screen.getByLabelText("End date and time"), { target: { value: "2031-05-20T10:30" } });
    fireEvent.change(screen.getByLabelText("Specialization"), { target: { value: "Cardiology" } });
    fireEvent.change(screen.getByLabelText("City"), { target: { value: "Demo City" } });
    fireEvent.change(screen.getByLabelText("Minimum experience (years)"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("Maximum fee (INR)"), { target: { value: "1000" } });
    fireEvent.click(screen.getByRole("button", { name: "Check doctor availability" }));
    expect(await screen.findByRole("option", { name: /Free Doctor/ })).toBeTruthy();
    const busyDoctor = await screen.findByText("Dr. Busy Doctor");
    expect(busyDoctor.parentElement?.textContent).toContain("Already booked");
    expect(screen.getByText(/Synthetic Patient/)).toBeTruthy();
  });
});
