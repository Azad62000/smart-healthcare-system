import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import PatientAppointmentsPage from "./page";

describe("patient appointments page", () => {
  beforeEach(() => vi.restoreAllMocks());
  it("shows doctors, loads slots, and books a selected time", async () => {
    const slot = { startsAt: "2030-01-01T10:00:00.000Z", endsAt: "2030-01-01T10:30:00.000Z" };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { doctors: [{ id: "doctor-id", givenName: "Sam", familyName: "Rivera", specialization: "Cardiology" }] } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { appointments: [] } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { slots: [slot] } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { appointment: { id: "appt-1" } } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { doctors: [] } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { appointments: [] } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { slots: [] } }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<PatientAppointmentsPage />);
    fireEvent.change(await screen.findByLabelText("Approved doctor"), { target: { value: "doctor-id" } });
    fireEvent.change(await screen.findByLabelText("Available time"), { target: { value: slot.startsAt } });
    fireEvent.click(screen.getByRole("button", { name: "Book appointment" }));
    expect((await screen.findByRole("status")).textContent).toContain("Appointment booked.");
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/api/v1/appointments"))).toBe(true);
  });

  it("keeps directory booking available when recommendations are disabled", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { doctors: [{ id: "doctor-id", givenName: "Sam", familyName: "Rivera", specialization: "Cardiology" }] } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { appointments: [] } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { enabled: false, recommendations: [] } }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<PatientAppointmentsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Find doctors" }));
    expect(await screen.findByText(/Recommendations are not enabled/)).toBeTruthy();
    expect(screen.getByLabelText("Approved doctor")).toBeTruthy();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/api/v1/doctors/recommendations"))).toBe(true);
  });

  it("lets a patient continue booking with a recommended doctor", async () => {
    const slot = { startsAt: "2030-01-01T10:00:00.000Z", endsAt: "2030-01-01T10:30:00.000Z" };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { doctors: [{ id: "doctor-id", givenName: "Sam", familyName: "Rivera", specialization: "Cardiology" }] } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { appointments: [] } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { enabled: true, recommendations: [{ doctor: { id: "doctor-id", givenName: "Sam", familyName: "Rivera", specialization: "Cardiology" }, earliestAvailableSlot: slot, reasons: ["Matches requested specialization: Cardiology", `Earliest available slot: ${slot.startsAt}`] }] } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { slots: [slot] } }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<PatientAppointmentsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Find doctors" }));
    fireEvent.click(await screen.findByRole("button", { name: "Choose this doctor" }));
    expect(await screen.findByLabelText("Available time")).toBeTruthy();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/api/v1/appointments/available-slots"))).toBe(true);
  });

  it("keeps a slot-conflict error visible after refreshing the now-unavailable slots", async () => {
    const slot = { startsAt: "2030-01-01T10:00:00.000Z", endsAt: "2030-01-01T10:30:00.000Z" };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { doctors: [{ id: "doctor-id", givenName: "Sam", familyName: "Rivera", specialization: "Cardiology" }] } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { appointments: [] } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { slots: [slot] } }) })
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: { message: "This appointment time is no longer available." } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { slots: [] } }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<PatientAppointmentsPage />);
    fireEvent.change(await screen.findByLabelText("Approved doctor"), { target: { value: "doctor-id" } });
    fireEvent.change(await screen.findByLabelText("Available time"), { target: { value: slot.startsAt } });
    fireEvent.click(screen.getByRole("button", { name: "Book appointment" }));
    expect((await screen.findByRole("alert")).textContent).toContain("This appointment time is no longer available.");
    expect(await screen.findByText("No published slots available for this mode in the next 30 days.")).toBeTruthy();
  });
});
