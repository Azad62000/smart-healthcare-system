import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import PatientDashboard from "./page";

vi.mock("next/navigation", () => ({ usePathname: () => "/patient", useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

describe("patient dashboard", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("shows loading, then appointment and records empty states and profile completion form", async () => {
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/v1/patients/me")) return Promise.resolve({ ok: true, json: async () => ({ data: { profile: null, complete: false } }) });
      if (url.includes("/api/v1/appointments/me")) return Promise.resolve({ ok: true, json: async () => ({ data: { appointments: [] } }) });
      return Promise.resolve({ ok: true, json: async () => ({ data: { records: [] } }) });
    }));
    render(<PatientDashboard />);
    expect(screen.getByLabelText("Loading patient profile")).toBeTruthy();
    expect(await screen.findByLabelText("First name")).toBeTruthy();
    expect(screen.getByText("No appointments yet")).toBeTruthy();
    expect(screen.getByText("No health records yet")).toBeTruthy();
  });

  it("renders a recoverable error when profile loading fails", async () => {
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      if (String(input).includes("/api/v1/patients/me")) return Promise.reject(new Error("Network unavailable"));
      if (String(input).includes("/api/v1/appointments/me")) return Promise.resolve({ ok: true, json: async () => ({ data: { appointments: [] } }) });
      return Promise.resolve({ ok: true, json: async () => ({ data: { records: [] } }) });
    }));
    render(<PatientDashboard />);
    expect((await screen.findByRole("alert")).textContent).toContain("Network unavailable");
    expect(screen.getAllByRole("button", { name: "Retry" }).length).toBeGreaterThan(0);
  });

  it("saves the profile through the API", async () => {
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/v1/patients/me") && init?.method === "PUT") return Promise.resolve({ ok: true, json: async () => ({ data: { complete: true, profile: { givenName: "Ada", familyName: "Lovelace", dateOfBirth: "1990-01-01", phone: "+1 555 010 1000", addressLine: null, city: null, postalCode: null } } }) });
      if (url.includes("/api/v1/patients/me")) return Promise.resolve({ ok: true, json: async () => ({ data: { profile: null, complete: false } }) });
      if (url.includes("/api/v1/appointments/me")) return Promise.resolve({ ok: true, json: async () => ({ data: { appointments: [] } }) });
      return Promise.resolve({ ok: true, json: async () => ({ data: { records: [] } }) });
    }));
    render(<PatientDashboard />);
    await screen.findByLabelText("First name");
    fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Ada" } });
    fireEvent.change(screen.getByLabelText("Last name"), { target: { value: "Lovelace" } });
    fireEvent.change(screen.getByLabelText("Date of birth"), { target: { value: "1990-01-01" } });
    fireEvent.change(screen.getByLabelText("Phone"), { target: { value: "+1 555 010 1000" } });
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
    expect((await screen.findByRole("status")).textContent).toContain("Your profile was saved.");
    await waitFor(() => expect(screen.getByText("Ada Lovelace")).toBeTruthy());
  });
});
