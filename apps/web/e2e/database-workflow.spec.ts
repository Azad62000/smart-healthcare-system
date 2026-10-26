import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { expect, request, test, type APIRequestContext, type Page } from "@playwright/test";

const enabled = process.env.RUN_DATABASE_E2E === "true";
const recommendationsEnabled = process.env.DOCTOR_RECOMMENDATIONS_ENABLED === "true";
const apiPort = Number(process.env.API_PORT ?? 4000);
const apiOrigin = process.env.NEXT_PUBLIC_API_URL ?? `http://localhost:${apiPort}`;
const databaseUrl = process.env.DATABASE_URL ?? "";
const doctorId = "10000000-0000-4000-8000-000000000001";
const doctorEmail = "demo.doctor@example.test";
const doctorPassword = "LocalDoctor!2026";

type CreatedPatient = { id: string; email: string; password: string };

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in securely" }).click();
}

async function deleteCreatedPatient(pool: Pool, patient: CreatedPatient | undefined) {
  if (!patient) return;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const owner = await client.query<{ id: string }>(
      "SELECT id FROM users WHERE id=$1 AND email=$2 AND role='Patient' FOR UPDATE",
      [patient.id, patient.email]
    );
    if (!owner.rows[0]) {
      await client.query("ROLLBACK");
      return;
    }
    await client.query("DELETE FROM health_record_access_events WHERE patient_id=$1 OR actor_user_id=$1", [patient.id]);
    await client.query("DELETE FROM consultation_records WHERE patient_id=$1", [patient.id]);
    await client.query(
      `DELETE FROM notifications
       WHERE recipient_user_id=$1 OR appointment_id IN (SELECT id FROM appointments WHERE patient_id=$1)`,
      [patient.id]
    );
    await client.query("DELETE FROM appointment_status_history WHERE appointment_id IN (SELECT id FROM appointments WHERE patient_id=$1)", [patient.id]);
    await client.query("DELETE FROM appointments WHERE patient_id=$1", [patient.id]);
    await client.query("DELETE FROM patients WHERE user_id=$1", [patient.id]);
    await client.query("DELETE FROM users WHERE id=$1 AND email=$2 AND role='Patient'", [patient.id, patient.email]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

test("@database patient, doctor, appointment, record, and ownership workflow", async ({ page }) => {
  test.skip(!enabled, "Set RUN_DATABASE_E2E=true to run against the guarded local PostgreSQL database.");
  expect(process.env.NODE_ENV).toBe("development");
  const parsedDatabaseUrl = new URL(databaseUrl);
  expect(["postgres:", "postgresql:"]).toContain(parsedDatabaseUrl.protocol);
  expect(["localhost", "127.0.0.1", "[::1]", "::1"]).toContain(parsedDatabaseUrl.hostname);
  expect(parsedDatabaseUrl.pathname.replace(/^\/+/, "")).toBe("smart_healthcare");

  const pool = new Pool({ connectionString: databaseUrl, max: 2, connectionTimeoutMillis: 5000 });
  const patientPassword = `Synthetic!${randomUUID()}Aa1`;
  const patientEmail = `e2e-${randomUUID()}@example.test`;
  const patientLabel = `E2E ${randomUUID().slice(0, 8)}`;
  const givenName = "Synthetic";
  const familyName = patientLabel.slice(4);
  const diagnosis = `Synthetic E2E ${randomUUID().slice(0, 8)}`;
  const note = "Synthetic workflow verification only; no clinical details.";
  let patient: CreatedPatient | undefined;
  let secondPatient: CreatedPatient | undefined;
  let patientApi: APIRequestContext | undefined;
  let secondPatientApi: APIRequestContext | undefined;
  let roleEscalationApi: APIRequestContext | undefined;
  let createdAppointmentId: string | undefined;

  try {
    const databaseCheck = await pool.query<{ current_database: string }>("SELECT current_database() AS current_database");
    expect(databaseCheck.rows[0]?.current_database).toBe("smart_healthcare");

    patientApi = await request.newContext({ baseURL: apiOrigin });
    const registration = await patientApi.post("/api/v1/auth/register", {
      data: { email: patientEmail, password: patientPassword }
    });
    expect(registration.status()).toBe(201);
    const registrationBody = await registration.json();
    patient = { id: registrationBody.data.user.id, email: patientEmail, password: patientPassword };
    expect(registrationBody.data.user.role).toBe("Patient");

    roleEscalationApi = await request.newContext({ baseURL: apiOrigin });
    const escalationEmail = `e2e-escalation-${randomUUID()}@example.test`;
    const escalationResponse = await roleEscalationApi.post("/api/v1/auth/register", {
      data: { email: escalationEmail, password: `Synthetic!${randomUUID()}Cc3`, role: "Admin" }
    });
    expect(escalationResponse.status()).toBe(400);
    const escalationAccount = await pool.query<{ count: number }>("SELECT count(*)::int AS count FROM users WHERE email=$1", [escalationEmail]);
    expect(escalationAccount.rows[0]?.count).toBe(0);

    const profile = await patientApi.put("/api/v1/patients/me", {
      data: {
        givenName,
        familyName,
        dateOfBirth: "1990-01-01",
        phone: "+1 555 0101",
        addressLine: null,
        city: null,
        postalCode: null
      }
    });
    expect(profile.status()).toBe(200);

    secondPatientApi = await request.newContext({ baseURL: apiOrigin });
    const secondEmail = `e2e-${randomUUID()}@example.test`;
    const secondPassword = `Synthetic!${randomUUID()}Bb2`;
    const secondRegistration = await secondPatientApi.post("/api/v1/auth/register", {
      data: { email: secondEmail, password: secondPassword }
    });
    expect(secondRegistration.status()).toBe(201);
    const secondRegistrationBody = await secondRegistration.json();
    secondPatient = { id: secondRegistrationBody.data.user.id, email: secondEmail, password: secondPassword };
    expect(secondRegistrationBody.data.user.role).toBe("Patient");
    const secondProfile = await secondPatientApi.put("/api/v1/patients/me", {
      data: {
        givenName: "Synthetic",
        familyName: `Race${randomUUID().slice(0, 6)}`,
        dateOfBirth: "1990-01-01",
        phone: "+1 555 0102",
        addressLine: null,
        city: null,
        postalCode: null
      }
    });
    expect(secondProfile.status()).toBe(200);

    const recommendationWindow = new URLSearchParams({
      from: new Date().toISOString(),
      to: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    });
    const recommendationResponse = await patientApi.get(`/api/v1/doctors/recommendations?${recommendationWindow}`);
    expect(recommendationResponse.status()).toBe(200);
    const recommendationData = (await recommendationResponse.json()).data;
    expect(recommendationData.enabled).toBe(recommendationsEnabled);
    if (!recommendationsEnabled) expect(recommendationData.recommendations).toEqual([]);
    else expect(recommendationData.recommendations.some((item: { doctor: { id: string } }) => item.doctor.id === doctorId)).toBe(true);

    await signIn(page, patient.email, patient.password);
    await page.waitForURL("**/patient");
    await expect(page.getByRole("heading", { name: `Welcome, ${givenName}` })).toBeVisible();

    await page.goto("/patient/appointments");
    if (recommendationsEnabled) {
      const doctorRecommendation = recommendationData.recommendations.find((item: { doctor: { id: string } }) => item.doctor.id === doctorId);
      await page.getByLabel("Specialization preference (optional)").fill(doctorRecommendation.doctor.specialization);
      await page.getByRole("button", { name: "Find doctors" }).click();
      await expect(page.locator(".recommendation-list")).toContainText(`Dr. ${doctorRecommendation.doctor.givenName} ${doctorRecommendation.doctor.familyName}`);
      await page.getByRole("button", { name: "Choose this doctor" }).click();
    } else {
      await page.getByRole("button", { name: "Find doctors" }).click();
      await expect(page.getByRole("status").filter({ hasText: "Recommendations are not enabled" })).toBeVisible();
      await page.getByLabel("Approved doctor").selectOption(doctorId);
    }
    const availableTime = page.getByLabel("Available time");
    await expect(availableTime).toBeVisible();
    await expect.poll(async () => availableTime.locator("option").count()).toBeGreaterThan(1);
    const slotStartsAt = await availableTime.locator("option").nth(1).getAttribute("value");
    expect(slotStartsAt).toBeTruthy();
    await availableTime.selectOption(slotStartsAt!);
    const slotSearchParams = new URLSearchParams({
      doctorId,
      from: new Date().toISOString(),
      to: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      timeZone: "UTC"
    });
    const slotResponse = await patientApi.get(`/api/v1/appointments/available-slots?${slotSearchParams}`);
    expect(slotResponse.status()).toBe(200);
    const slots = (await slotResponse.json()).data.slots as Array<{ startsAt: string; endsAt: string }>;
    const selectedSlot = slots.find((slot) => slot.startsAt === slotStartsAt);
    expect(selectedSlot).toBeTruthy();

    if (recommendationsEnabled) {
      const conflictResponse = await secondPatientApi.post("/api/v1/appointments", {
        data: { doctorId, startsAt: selectedSlot!.startsAt, endsAt: selectedSlot!.endsAt }
      });
      expect(conflictResponse.status()).toBe(201);
      const conflictAppointmentId = (await conflictResponse.json()).data.appointment.id as string;
      const failedBookingResponsePromise = page.waitForResponse((response) =>
        response.url() === `${apiOrigin}/api/v1/appointments` && response.request().method() === "POST"
      );
      await page.getByRole("button", { name: "Book appointment" }).click();
      const failedBookingResponse = await failedBookingResponsePromise;
      expect(failedBookingResponse.status()).toBe(409);
      await expect(page.getByRole("alert").filter({ hasText: "This appointment time is no longer available" })).toBeVisible();
      const cancelConflict = await secondPatientApi.post(`/api/v1/appointments/${conflictAppointmentId}/cancel`, {
        data: { reason: "Synthetic E2E slot-conflict verification" }
      });
      expect(cancelConflict.status()).toBe(200);
      await page.reload();
      await page.getByLabel("Approved doctor").selectOption(doctorId);
      await expect(page.getByLabel("Available time")).toBeVisible();
      await page.getByLabel("Available time").selectOption(slotStartsAt!);
    }

    const bookingResponsePromise = page.waitForResponse((response) =>
      response.url() === `${apiOrigin}/api/v1/appointments` && response.request().method() === "POST"
    );
    await page.getByRole("button", { name: "Book appointment" }).click();
    const bookingResponse = await bookingResponsePromise;
    expect(bookingResponse.status()).toBe(201);
    createdAppointmentId = (await bookingResponse.json()).data.appointment.id as string;
    await expect(page.getByRole("status").filter({ hasText: "Appointment booked." })).toBeVisible();

    await signIn(page, doctorEmail, doctorPassword);
    await page.waitForURL("**/doctor");
    const appointmentRow = page.locator(".appointment-list > li").filter({ hasText: `${givenName} ${familyName}` });
    await expect(appointmentRow).toBeVisible();
    await appointmentRow.getByRole("button", { name: "Confirm" }).click();
    await expect(appointmentRow.getByText("confirmed", { exact: true })).toBeVisible();

    await page.getByLabel("Patient").selectOption(patient.id);
    await page.getByLabel("Diagnosis (optional)").fill(diagnosis);
    await page.getByLabel("Consultation note").fill(note);
    await page.getByRole("button", { name: "Save consultation" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Consultation record saved." })).toBeVisible();

    await signIn(page, patient.email, patient.password);
    await page.waitForURL("**/patient");
    await expect(page.getByRole("heading", { name: "Notifications" })).toBeVisible();
    await expect(page.getByText("Appointment status updated", { exact: true })).toBeVisible();
    await page.goto("/patient/records");
    await expect(page.getByRole("heading", { name: diagnosis, exact: true })).toBeVisible();
    await expect(page.getByText(note, { exact: true })).toBeVisible();

    const ownRecordsResponse = await page.request.get(`${apiOrigin}/api/v1/records/me`);
    expect(ownRecordsResponse.status()).toBe(200);
    const ownRecordsBody = await ownRecordsResponse.json();
    const createdRecordId = ownRecordsBody.data.records.find((record: { diagnosis: string }) => record.diagnosis === diagnosis)?.id as string | undefined;
    expect(createdRecordId).toBeTruthy();

    const crossPatientResponse = await secondPatientApi.get(`/api/v1/records/me/${createdRecordId}`);
    expect(crossPatientResponse.status()).toBe(404);

    const releaseSlot = await patientApi.post(`/api/v1/appointments/${createdAppointmentId}/cancel`, {
      data: { reason: "Synthetic concurrency verification setup" }
    });
    expect(releaseSlot.status()).toBe(200);
    const concurrentBookingPayload = {
      doctorId,
      startsAt: selectedSlot!.startsAt,
      endsAt: selectedSlot!.endsAt
    };
    const competingBookings = await Promise.all([
      patientApi.post("/api/v1/appointments", { data: concurrentBookingPayload }),
      secondPatientApi.post("/api/v1/appointments", { data: concurrentBookingPayload })
    ]);
    const bookingStatuses = competingBookings.map((response) => response.status()).sort((left, right) => left - right);
    expect(bookingStatuses).toEqual([201, 409]);
  } finally {
    await patientApi?.dispose();
    await secondPatientApi?.dispose();
    await roleEscalationApi?.dispose();
    try {
      await deleteCreatedPatient(pool, secondPatient);
      await deleteCreatedPatient(pool, patient);
    } finally {
      await pool.end();
    }
  }
});
