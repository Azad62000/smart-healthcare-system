import { expect, test } from "@playwright/test";

async function mockSession(page: import("@playwright/test").Page, role: "Patient" | "Doctor" | "Admin") {
  await page.route("**/api/v1/auth/me", (route) => route.fulfill({ json: { success: true, data: { user: { id: "synthetic-user", email: "demo@example.test", role } } } }));
  await page.route("**/api/v1/notifications/me", (route) => route.fulfill({ json: { success: true, data: { notifications: [], unreadCount: 0 } } }));
}

test("patient dashboard provides labelled navigation, profile, and empty states", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockSession(page, "Patient");
  await page.route("**/api/v1/patients/me", (route) => route.fulfill({ json: { success: true, data: { complete: true, profile: { givenName: "Taylor", familyName: "Patient", dateOfBirth: "1990-01-01", phone: "+1 555 0100", addressLine: null, city: null, postalCode: null } } } }));
  await page.route("**/api/v1/appointments/me?**", (route) => route.fulfill({ json: { success: true, data: { appointments: [] } } }));
  await page.route("**/api/v1/records/me", (route) => route.fulfill({ json: { success: true, data: { records: [] } } }));
  await page.goto("/patient");
  await expect(page.getByRole("heading", { name: "Welcome, Taylor" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Dashboard navigation" }).getByRole("link", { name: "Overview" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: "No appointments yet" })).toBeVisible();
  const overviewLink = page.getByRole("navigation", { name: "Dashboard navigation" }).getByRole("link", { name: "Overview" });
  const findDoctorLink = page.getByRole("navigation", { name: "Dashboard navigation" }).getByRole("link", { name: "Find a doctor" });
  await overviewLink.focus();
  await expect(overviewLink).toBeFocused();
  await expect(overviewLink).toHaveAttribute("aria-current", "page");
  await page.keyboard.press("Tab");
  await expect(findDoctorLink).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("doctor dashboard shows schedule and patient-care sections", async ({ page }) => {
  await mockSession(page, "Doctor");
  await page.route("**/api/v1/doctors/me", (route) => route.fulfill({ json: { success: true, data: { complete: true, profile: { id: "synthetic-doctor", givenName: "Jordan", familyName: "Clinician", specialization: "Cardiology", qualification: "MD", experienceYears: 8, bio: null, approvalStatus: "approved", availability: [] } } } }));
  await page.route("**/api/v1/appointments/doctor/me?**", (route) => route.fulfill({ json: { success: true, data: { appointments: [] } } }));
  await page.goto("/doctor");
  await expect(page.getByRole("heading", { name: "Doctor dashboard" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Availability", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "No appointments yet" })).toBeVisible();
  await expect(page.getByLabel("Starts")).toBeVisible();
  await expect(page.getByLabel("Ends")).toBeVisible();
});

test("admin dashboard renders aggregate analytics in an accessible table", async ({ page }) => {
  await mockSession(page, "Admin");
  await page.route("**/api/v1/analytics/overview", (route) => route.fulfill({ json: { success: true, data: { overview: { patientCount: 12, approvedDoctorCount: 4, appointmentCount: 9, appointmentsByStatus: [{ status: "booked", count: 2 }, { status: "confirmed", count: 3 }, { status: "completed", count: 4 }], pendingAppointmentCount: 2, upcomingAppointmentCount: 3, generatedAt: "2026-01-01T00:00:00.000Z" } } } }));
  await page.route("**/api/v1/doctors/pending", (route) => route.fulfill({ json: { success: true, data: { doctors: [] } } }));
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Operational overview" })).toBeVisible();
  await expect(page.getByRole("table", { name: "Appointments by status" })).toBeVisible();
  await expect(page.getByRole("row", { name: "Total 9" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Dashboard navigation" }).getByRole("link", { name: "Overview" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("No pending doctor applications.")).toBeVisible();
});

test("patient selects a published slot and receives booking confirmation", async ({ page }) => {
  await mockSession(page, "Patient");
  await page.route("**/api/v1/doctors/directory", (route) => route.fulfill({ json: { success: true, data: { doctors: [{ id: "doctor-1", givenName: "Jordan", familyName: "Clinician", specialization: "Cardiology" }] } } }));
  await page.route("**/api/v1/appointments/me?**", (route) => route.fulfill({ json: { success: true, data: { appointments: [] } } }));
  await page.route("**/api/v1/appointments/available-slots?**", (route) => route.fulfill({ json: { success: true, data: { slots: [{ startsAt: "2030-01-01T10:00:00.000Z", endsAt: "2030-01-01T10:30:00.000Z" }] } } }));
  await page.route("**/api/v1/appointments", (route) => route.fulfill({ status: 201, json: { success: true, data: { appointment: { id: "appointment-1" } } } }));
  await page.goto("/patient/appointments");
  await page.getByLabel("Approved doctor").selectOption("doctor-1");
  await page.getByLabel("Available time").selectOption("2030-01-01T10:00:00.000Z");
  await page.getByRole("button", { name: "Book appointment" }).click();
  await expect(page.getByText("Appointment booked.", { exact: true })).toBeVisible();
});

test("doctor reviews an assigned patient and saves a consultation", async ({ page }) => {
  await mockSession(page, "Doctor");
  await page.route("**/api/v1/doctors/me", (route) => route.fulfill({ json: { success: true, data: { complete: true, profile: { id: "doctor-1", givenName: "Jordan", familyName: "Clinician", specialization: "Cardiology", qualification: "MD", experienceYears: 8, bio: null, approvalStatus: "approved", availability: [] } } } }));
  await page.route("**/api/v1/appointments/doctor/me?**", (route) => route.fulfill({ json: { success: true, data: { appointments: [{ id: "appointment-1", patientId: "patient-1", patientDisplayName: "Taylor Patient", startsAt: "2030-01-01T10:00:00.000Z", endsAt: "2030-01-01T10:30:00.000Z", status: "confirmed" }] } } }));
  await page.route("**/api/v1/records/doctor?patientId=patient-1", (route) => route.fulfill({ json: { success: true, data: { records: [] } } }));
  await page.route("**/api/v1/records/doctor", (route) => route.fulfill({ status: 201, json: { success: true, data: { record: { id: "record-1", consultationAt: "2030-01-01T10:00:00.000Z", diagnosis: "Routine review", note: "Follow-up scheduled." } } } }));
  await page.goto("/doctor");
  await page.getByLabel("Patient").selectOption("patient-1");
  await page.getByLabel("Diagnosis (optional)").fill("Routine review");
  await page.getByLabel("Consultation note").fill("Follow-up scheduled.");
  await page.getByRole("button", { name: "Save consultation" }).click();
  await expect(page.getByRole("status")).toContainText("Consultation record saved.");
});
