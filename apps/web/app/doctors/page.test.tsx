import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import DoctorDirectoryPage from "./page";

describe("doctor directory", () => {
  beforeEach(() => vi.restoreAllMocks());
  it("shows loading then approved doctor cards and applies filters", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { doctors: [{ id: "id-1", givenName: "Sam", familyName: "Rivera", specialization: "Cardiology", qualification: "MD", experienceYears: 8, availability: [] }] } }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<DoctorDirectoryPage />);
    expect(screen.getByRole("status").textContent).toContain("Loading");
    expect(await screen.findByText("Dr. Sam Rivera")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Specialization"), { target: { value: "Cardiology" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply filter" }));
    expect(fetchMock).toHaveBeenLastCalledWith(expect.stringContaining("specialization=Cardiology"));
  });
  it("shows an empty state when the approved directory has no matches", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { doctors: [] } }) }));
    render(<DoctorDirectoryPage />);
    expect(await screen.findByText("No approved doctors found")).toBeTruthy();
  });

  it("shows the mapped illustrative portrait and identifies fictional clinicians", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { doctors: [{ id: "id-1", givenName: "Anjali", familyName: "Malhotra", specialization: "Pediatrics", qualification: null, experienceYears: null, isSynthetic: true, availability: [] }] } }) }));
    render(<DoctorDirectoryPage />);
    const portrait = await screen.findByRole("img", { name: "Illustration of fictional clinician Dr. Anjali Malhotra" });
    expect(portrait.getAttribute("src")).toBe("/images/doctors/doctor-001.webp");
    expect(screen.getByText("Fictional clinician · not for real care")).toBeTruthy();
    expect(screen.getByText("Illustration · fictional clinician")).toBeTruthy();
  });
});
