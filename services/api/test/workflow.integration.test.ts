import { beforeEach, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import type { AuthRepository, PublicUser, UserRecord, UserRole } from "../src/auth/repository.js";
import type { PatientProfile, PatientProfileInput, PatientRepository } from "../src/patients/types.js";
import type { DoctorApprovalStatus, DoctorAvailability, DoctorProfile, DoctorProfileInput, DoctorRepository } from "../src/doctors/types.js";
import type { Appointment, AppointmentRepository, AppointmentStatus, AvailableSlot } from "../src/appointments/types.js";
import type { ConsultationInput, ConsultationRecord, RecordRepository } from "../src/records/types.js";
import type { Notification, NotificationRepository } from "../src/notifications/types.js";
import { createAuthRouter } from "../src/auth/routes.js";
import { sessionCookieName } from "../src/auth/routes.js";
import { createPatientRouter } from "../src/patients/routes.js";
import { createDoctorRouter } from "../src/doctors/routes.js";
import { createAppointmentRouter } from "../src/appointments/routes.js";
import { createRecordRouter } from "../src/records/routes.js";
import { createNotificationRouter } from "../src/notifications/routes.js";
import { errorHandler } from "../src/middleware/error-handler.js";
import { requestIdMiddleware } from "../src/middleware/request-id.js";
import type { EmailCodePurpose, EmailCodeRepository } from "../src/auth/email-code-repository.js";

const doctorUserId = "11111111-1111-4111-8111-111111111111";
const adminUserId = "22222222-2222-4222-8222-222222222222";
const doctorId = "33333333-3333-4333-8333-333333333333";

class WorkflowRepository {
  users = new Map<string, UserRecord>();
  sessions = new Map<string, string>();
  patients = new Map<string, PatientProfile>();
  doctors = new Map<string, DoctorProfile>();
  appointments: Appointment[] = [];
  records: ConsultationRecord[] = [];
  notifications: Array<Notification & { recipientId: string; eventKey: string }> = [];
  slot = { startsAt: new Date(Date.now() + 48 * 3600_000).toISOString(), endsAt: new Date(Date.now() + 49 * 3600_000).toISOString() };

  async addUser(id: string, email: string, role: UserRole, password = "seeded-password-123") {
    this.users.set(id, { id, email, role, status: "active", email_verified: true, password_hash: await bcrypt.hash(password, 4) });
  }
  async createPatient(email: string, password: string): Promise<PublicUser> {
    const id = `44444444-4444-4444-8444-${String(this.users.size + 1).padStart(12, "0")}`;
    const user: UserRecord = { id, email, role: "Patient", status: "active", email_verified: false, password_hash: await bcrypt.hash(password, 4) };
    this.users.set(id, user); return { id, email, role: user.role, status: user.status };
  }
  async findByEmail(email: string) { return [...this.users.values()].find((user) => user.email === email); }
  async findById(id: string) { const user = this.users.get(id); return user && { id, email: user.email, role: user.role, status: user.status }; }
  async createSession(userId: string, _ttlHours = 12) { const token = `token-${userId}-${this.sessions.size}`; this.sessions.set(token, userId); return token; }
  async findSession(token: string) { const user = this.users.get(this.sessions.get(token) ?? ""); return user?.status === "active" ? { id: user.id, email: user.email, role: user.role, status: user.status } : undefined; }
  async deleteSession(token: string) { this.sessions.delete(token); }

  async findPatientByUserId(userId: string) { return this.patients.get(userId); }
  async createPatientProfile(userId: string, input: PatientProfileInput) { const now = new Date().toISOString(); const item = { userId, ...input, createdAt: now, updatedAt: now }; this.patients.set(userId, item); return item; }
  async updatePatientProfile(userId: string, input: PatientProfileInput) { return this.createPatientProfile(userId, input); }

  async listApproved(specialization?: string) { return [...this.doctors.values()].filter((d) => d.approvalStatus === "approved" && (!specialization || d.specialization.toLowerCase() === specialization.toLowerCase())); }
  async listPending() { return [...this.doctors.values()].filter((d) => d.approvalStatus === "pending"); }
  async findPublicById(id: string) { const doctor = this.doctors.get(id); return doctor?.approvalStatus === "approved" ? doctor : undefined; }
  async saveProfile(userId: string, input: DoctorProfileInput) {
    const existing = [...this.doctors.values()].find((d) => d.userId === userId); const now = new Date().toISOString();
    const doctor: DoctorProfile = { id: existing?.id ?? doctorId, userId, ...input, approvalStatus: existing?.approvalStatus ?? "pending", availability: existing?.availability ?? [], createdAt: existing?.createdAt ?? now, updatedAt: now };
    this.doctors.set(doctor.id, doctor); return doctor;
  }
  async setApprovalStatus(id: string, status: DoctorApprovalStatus) { const doctor = this.doctors.get(id); if (!doctor) return undefined; const updated = { ...doctor, approvalStatus: status }; this.doctors.set(id, updated); return updated; }
  async replaceAvailability(userId: string, slots: Array<{ startsAt: string; endsAt: string }>) { const doctor = [...this.doctors.values()].find((d) => d.userId === userId); if (!doctor) return []; const availability = slots.map((slot, i) => ({ id: `slot-${i}`, ...slot })); this.doctors.set(doctor.id, { ...doctor, availability }); return availability; }

  async listAvailableSlots(id: string, from: string, to: string): Promise<AvailableSlot[]> { const doctor = this.doctors.get(id); const published = doctor?.availability.some((slot) => slot.startsAt === this.slot.startsAt && slot.endsAt === this.slot.endsAt); return doctor?.approvalStatus === "approved" && published && this.slot.startsAt >= from && this.slot.endsAt <= to && !this.appointments.some((a) => a.doctorId === id && ["booked", "confirmed"].includes(a.status)) ? [this.slot] : []; }
  async createAppointment(patientId: string, id: string, startsAt: string, endsAt: string): Promise<Appointment> {
    const doctor = this.doctors.get(id);
    if (!doctor || doctor.approvalStatus !== "approved") throw Object.assign(new Error("unapproved"), { code: "DOCTOR_NOT_APPROVED" });
    if (!this.patients.has(patientId)) throw Object.assign(new Error("profile"), { code: "PATIENT_PROFILE_REQUIRED" });
    if (this.appointments.some((a) => ["booked", "confirmed"].includes(a.status) && a.doctorId === id && a.startsAt < endsAt && a.endsAt > startsAt)) throw Object.assign(new Error("overlap"), { code: "23P01" });
    const appointment: Appointment = { id: "55555555-5555-4555-8555-555555555555", patientId, doctorId: id, startsAt, endsAt, status: "booked", patientDisplayName: "Synthetic Patient", doctorDisplayName: `${doctor.givenName} ${doctor.familyName}`, specialization: doctor.specialization };
    this.appointments.push(appointment); this.notify(appointment, "created"); return appointment;
  }
  async listPatientAppointments(userId: string, from?: string, to?: string) { return this.appointments.filter((a) => a.patientId === userId && (!from || a.startsAt >= from) && (!to || a.startsAt < to)); }
  async listDoctorAppointments(id: string, from?: string, to?: string) { return this.appointments.filter((a) => a.doctorId === id && (!from || a.startsAt >= from) && (!to || a.startsAt < to)); }
  async findDoctorIdByUserId(userId: string) { return [...this.doctors.values()].find((d) => d.userId === userId)?.id; }
  async findDoctorByUserId(userId: string) { return [...this.doctors.values()].find((d) => d.userId === userId); }
  async findForActor(id: string, actorId: string, role: "Patient" | "Doctor" | "Admin") { return this.appointments.find((a) => a.id === id && (role === "Admin" || (role === "Patient" ? a.patientId === actorId : this.doctors.get(a.doctorId)?.userId === actorId))); }
  async findAppointmentById(id: string) { return this.appointments.find((a) => a.id === id); }
  async hasCareRelationship(id: string, patientId: string) { return this.appointments.some((a) => a.doctorId === id && a.patientId === patientId && ["confirmed", "completed"].includes(a.status)); }
  async cancel(id: string, actorId: string, role: "Patient" | "Doctor", _reason?: string) { const a = this.appointments.find((item) => item.id === id && ["booked", "confirmed"].includes(item.status) && (role === "Patient" ? item.patientId === actorId : this.doctors.get(item.doctorId)?.userId === actorId)); if (!a) return undefined; a.status = "cancelled"; this.notify(a, "cancelled"); return a; }
  async transition(id: string, actorId: string, status: AppointmentStatus) { const a = this.appointments.find((item) => item.id === id && this.doctors.get(item.doctorId)?.userId === actorId); if (!a || !(a.status === "booked" && status === "confirmed")) return undefined; a.status = status; this.notify(a, `status_changed:${status}`); return a; }
  private notify(appointment: Appointment, event: string) {
    const doctorUser = this.doctors.get(appointment.doctorId)?.userId;
    for (const recipientId of [appointment.patientId, doctorUser].filter((value): value is string => Boolean(value))) {
      const eventKey = `${appointment.id}:${event}`;
      if (!this.notifications.some((item) => item.recipientId === recipientId && item.eventKey === eventKey)) this.notifications.push({ id: `notification-${this.notifications.length + 1}`, recipientId, eventKey, eventType: event.startsWith("status_changed") ? "status_changed" : event as "created" | "cancelled", appointmentId: appointment.id, title: "Appointment update", message: "Your appointment has an update.", createdAt: new Date().toISOString(), readAt: null });
    }
  }

  async listPatientRecords(patientId: string): Promise<ConsultationRecord[]> { return this.records.filter((record) => record.patientId === patientId); }
  async listDoctorRecords(id: string, patientId?: string): Promise<ConsultationRecord[]> { return this.records.filter((record) => record.doctorId === id && (!patientId || record.patientId === patientId)); }
  async findForPatient(recordId: string, patientId: string) { return this.records.find((record) => record.id === recordId && record.patientId === patientId); }
  async createConsultation(doctorId: string, input: ConsultationInput, actorUserId: string, requestId: string): Promise<ConsultationRecord> { const doctor = this.doctors.get(doctorId)!; const record: ConsultationRecord = { id: "66666666-6666-4666-8666-666666666666", patientId: input.patientId, doctorId, appointmentId: input.appointmentId ?? null, consultationAt: input.consultationAt ?? new Date().toISOString(), note: input.note, diagnosis: input.diagnosis ?? null, doctorDisplayName: `${doctor.givenName} ${doctor.familyName}`, specialization: doctor.specialization, createdAt: new Date().toISOString() }; this.records.push(record); await this.audit(actorUserId, input.patientId, record.id, "create", requestId); return record; }
  async audit(_actor: string, _patient: string, _recordId: string | null, _action: "list" | "read" | "create", _requestId: string) {}

  async listForUser(userId: string) { return this.notifications.filter((item) => item.recipientId === userId).reverse().map(({ recipientId: _recipientId, eventKey: _eventKey, ...notification }) => notification); }
  async markReadForUser(id: string, userId: string) { const item = this.notifications.find((row) => row.id === id && row.recipientId === userId); if (!item) return undefined; item.readAt ??= new Date().toISOString(); const { recipientId: _recipientId, eventKey: _eventKey, ...notification } = item; return notification; }
}

function makeApp(repository: WorkflowRepository) {
  const app = express(); app.use(express.json()); app.use(cookieParser()); app.use(requestIdMiddleware);
  const auth: AuthRepository = repository;
  const patients: PatientRepository = { findByUserId: (id) => repository.findPatientByUserId(id), create: (id, input) => repository.createPatientProfile(id, input), update: (id, input) => repository.updatePatientProfile(id, input) };
  const doctors: DoctorRepository = { listApproved: (specialization) => repository.listApproved(specialization), listPending: () => repository.listPending(), findPublicById: (id) => repository.findPublicById(id), findByUserId: (id) => repository.findDoctorByUserId(id), saveProfile: (id, profile) => repository.saveProfile(id, profile), setApprovalStatus: (id, status) => repository.setApprovalStatus(id, status), replaceAvailability: (id, slots) => repository.replaceAvailability(id, slots) };
  const appointments: AppointmentRepository = { listAvailableSlots: (doctor, from, to) => repository.listAvailableSlots(doctor, from, to), create: (patient, doctor, starts, ends, _actor) => repository.createAppointment(patient, doctor, starts, ends), listForPatient: (id, from, to) => repository.listPatientAppointments(id, from, to), listForDoctor: (id, from, to) => repository.listDoctorAppointments(id, from, to), findDoctorIdByUserId: (id) => repository.findDoctorIdByUserId(id), findForActor: (...args) => repository.findForActor(...args), findById: (id) => repository.findAppointmentById(id), hasCareRelationship: (...args) => repository.hasCareRelationship(...args), cancel: (...args) => repository.cancel(...args), transition: (...args) => repository.transition(...args) };
  const records: RecordRepository = { listForPatient: (id) => repository.listPatientRecords(id), listForDoctor: (id, patientId) => repository.listDoctorRecords(id, patientId), findForPatient: (id, patient) => repository.findForPatient(id, patient), create: (doctor, input, actor, requestId) => repository.createConsultation(doctor, input, actor, requestId), audit: (...args) => repository.audit(...args) };
  const notifications: NotificationRepository = { listForUser: (id) => repository.listForUser(id), markReadForUser: (id, user) => repository.markReadForUser(id, user) };
  const emailCodes: EmailCodeRepository = {
    async issue() { return "123456"; },
    async consume(userId, purpose, code, passwordHash) {
      const user = repository.users.get(userId);
      if (!user || code !== "123456") return false;
      if (purpose === "verify_email") user.email_verified = true;
      else if (passwordHash) user.password_hash = passwordHash;
      else return false;
      return true;
    }
  };
  app.use("/api/v1/auth", createAuthRouter(auth, {
    sessionTtlHours: 12,
    secureCookie: false,
    emailCodeRepository: emailCodes,
    emailDeliveryConfigured: true,
    sendEmailCode: async () => {},
    loginAttemptLimiter: {
      async consume() { return { allowed: true, retryAfterSeconds: 0 }; },
      async clear() {}
    }
  }));
  app.use("/api/v1/patients", createPatientRouter(auth, patients, sessionCookieName));
  app.use("/api/v1/doctors", createDoctorRouter(auth, doctors, sessionCookieName));
  app.use("/api/v1/appointments", createAppointmentRouter(auth, appointments, sessionCookieName));
  app.use("/api/v1/records", createRecordRouter(auth, records, appointments, doctors, sessionCookieName));
  app.use("/api/v1/notifications", createNotificationRouter(auth, notifications, sessionCookieName));
  app.use(errorHandler); return app;
}

describe("patient to appointment, record, and notification integration", () => {
  let repository: WorkflowRepository;
  let app: express.Express;
  beforeEach(async () => {
    repository = new WorkflowRepository(); app = makeApp(repository);
    await repository.addUser(doctorUserId, "doctor@example.test", "Doctor");
    await repository.addUser(adminUserId, "admin@example.test", "Admin");
  });

  it("completes registration through authorized record view and dashboard notification reads", async () => {
    const registration = await request(app).post("/api/v1/auth/register").send({ email: "patient@example.test", password: "patient-password-123" });
    expect(registration.status).toBe(201); expect(registration.body.data.emailVerificationRequired).toBe(true);
    const verification = await request(app).post("/api/v1/auth/email/verification/confirm").send({ email: "patient@example.test", code: "123456" });
    expect(verification.status).toBe(200);
    const patientCookie = verification.headers["set-cookie"][0].split(";")[0];
    const patientId = [...repository.users.values()].find((user) => user.email === "patient@example.test")!.id;
    const profile = await request(app).put("/api/v1/patients/me").set("Cookie", patientCookie).send({ givenName: "Taylor", familyName: "Patient", dateOfBirth: "1990-01-01", phone: "+1 555 0100" });
    expect(profile.status).toBe(200);

    const doctorCookie = `healthcare_session=${await repository.createSession(doctorUserId, 12)}`;
    const doctorProfile = await request(app).put("/api/v1/doctors/me").set("Cookie", doctorCookie).send({ givenName: "Jordan", familyName: "Clinician", specialization: "Cardiology", qualification: "MD", experienceYears: 8, bio: "Synthetic demo profile" });
    expect(doctorProfile.status).toBe(200);
    const approval = await request(app).patch(`/api/v1/doctors/${doctorId}/approval`).set("Cookie", `healthcare_session=${await repository.createSession(adminUserId, 12)}`).send({ status: "approved" });
    expect(approval.status).toBe(200);
    const startsAt = repository.slot.startsAt; const endsAt = repository.slot.endsAt;
    const availability = await request(app).put("/api/v1/doctors/me/availability").set("Cookie", doctorCookie).send({ slots: [{ startsAt, endsAt }] });
    expect(availability.status).toBe(200);
    const directory = await request(app).get("/api/v1/doctors/directory?specialization=Cardiology");
    expect(directory.body.data.doctors).toHaveLength(1);

    const from = new Date(Date.now()).toISOString(); const to = new Date(Date.now() + 4 * 86400_000).toISOString();
    const slots = await request(app).get(`/api/v1/appointments/available-slots?doctorId=${doctorId}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    expect(slots.body.data.slots).toHaveLength(1);
    const booking = await request(app).post("/api/v1/appointments").set("Cookie", patientCookie).send({ doctorId, startsAt, endsAt });
    expect(booking.status).toBe(201);
    const appointmentId = booking.body.data.appointment.id as string;
    const queue = await request(app).get("/api/v1/appointments/doctor/me").set("Cookie", doctorCookie);
    expect(queue.body.data.appointments).toHaveLength(1);
    const confirmation = await request(app).patch(`/api/v1/appointments/${appointmentId}/status`).set("Cookie", doctorCookie).send({ status: "confirmed" });
    expect(confirmation.status).toBe(200);

    const consultation = await request(app).post("/api/v1/records/doctor").set("Cookie", doctorCookie).send({ patientId, appointmentId, diagnosis: "Synthetic diagnosis", note: "Synthetic consultation note" });
    expect(consultation.status).toBe(201);
    const ownRecords = await request(app).get("/api/v1/records/me").set("Cookie", patientCookie);
    expect(ownRecords.status).toBe(200); expect(ownRecords.body.data.records).toHaveLength(1);
    const patientNotifications = await request(app).get("/api/v1/notifications/me").set("Cookie", patientCookie);
    expect(patientNotifications.status).toBe(200); expect(patientNotifications.body.data.notifications.map((item: Notification) => item.eventType)).toEqual(["status_changed", "created"]);
    expect(patientNotifications.body.data.unreadCount).toBe(2);
    expect(repository.patients.has(patientId)).toBe(true);
  });
});
