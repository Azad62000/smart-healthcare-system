import { beforeEach, describe, expect, it } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import type { AuthRepository, PublicUser, UserRecord } from "../src/auth/repository.js";
import type { Appointment, AppointmentRepository, AvailableSlot } from "../src/appointments/types.js";
import type { DoctorAvailability, DoctorProfile, DoctorProfileInput, DoctorRepository, DoctorApprovalStatus } from "../src/doctors/types.js";
import { createPrescriptionRouter } from "../src/prescriptions/routes.js";
import type { Prescription, PrescriptionInput, PrescriptionRepository } from "../src/prescriptions/types.js";
import { errorHandler } from "../src/middleware/error-handler.js";
import { requestIdMiddleware } from "../src/middleware/request-id.js";

const appointmentId = "11111111-1111-4111-8111-111111111111";
const doctorId = "22222222-2222-4222-8222-222222222222";
const patientId = "33333333-3333-4333-8333-333333333333";

class AuthFixture implements AuthRepository {
  users = new Map<string, PublicUser>();
  sessions = new Map<string, string>();
  async addUser(id: string, role: PublicUser["role"]) { const user = { id, email: `${id}@example.test`, role, status: "active" as const }; this.users.set(id, user); return user; }
  async createPatient(email: string) { return this.addUser(email, "Patient"); }
  async findByEmail(email: string): Promise<UserRecord | undefined> { const user = [...this.users.values()].find((candidate) => candidate.email === email); return user && { ...user, password_hash: "unused" }; }
  async findById(id: string) { return this.users.get(id); }
  async createSession(userId: string) { const token = `session-${userId}`; this.sessions.set(token, userId); return token; }
  async findSession(token: string) { return this.users.get(this.sessions.get(token) ?? ""); }
  async deleteSession(token: string) { this.sessions.delete(token); }
}

class AppointmentFixture implements AppointmentRepository {
  appointments = new Map<string, Appointment>();
  async listAvailableSlots(): Promise<AvailableSlot[]> { return []; }
  async create(): Promise<never> { throw new Error("not used"); }
  async listForPatient() { return []; }
  async listForDoctor() { return []; }
  async findDoctorIdByUserId() { return undefined; }
  async findForActor() { return undefined; }
  async findById(id: string) { return this.appointments.get(id); }
  async hasCareRelationship(id: string, patient: string) { return [...this.appointments.values()].some((a) => a.doctorId === id && a.patientId === patient && ["confirmed", "completed"].includes(a.status)); }
  async cancel() { return undefined; }
  async transition() { return undefined; }
}

class PrescriptionFixture implements DoctorRepository, PrescriptionRepository {
  profiles = new Map<string, DoctorProfile>();
  prescriptions: Prescription[] = [];
  audits: string[] = [];
  async listApproved() { return [...this.profiles.values()].filter((profile) => profile.approvalStatus === "approved"); }
  async listPending() { return [...this.profiles.values()].filter((profile) => profile.approvalStatus === "pending"); }
  async findPublicById(id: string) { return this.profiles.get(id); }
  async findByUserId(userId: string) { return [...this.profiles.values()].find((profile) => profile.userId === userId); }
  async saveProfile(_userId: string, _profile: DoctorProfileInput): Promise<never> { throw new Error("not used"); }
  async setApprovalStatus(_id: string, _status: DoctorApprovalStatus) { return undefined; }
  async replaceAvailability(_userId: string, _slots: Array<{ startsAt: string; endsAt: string }>): Promise<DoctorAvailability[]> { return []; }
  async listForPatient(id: string, actor: string, requestId: string) {
    this.audits.push(`${actor}:${id}:${requestId}`);
    return this.prescriptions.filter((item) => item.patientId === id);
  }
  async listForDoctor(id: string, patient: string, actor: string, requestId: string) {
    this.audits.push(`${actor}:${patient}:${requestId}`);
    return this.prescriptions.filter((item) => item.doctorId === id && item.patientId === patient);
  }
  async create(doctor: string, input: PrescriptionInput, actor: string, requestId: string) {
    const item: Prescription = {
      id: "44444444-4444-4444-8444-444444444444", ...input, doctorId: doctor, status: "active",
      issuedAt: new Date().toISOString(), doctorDisplayName: "Sam Rivera"
    };
    this.prescriptions.push(item);
    this.audits.push(`${actor}:${input.patientId}:${requestId}`);
    return item;
  }
}

describe("Prescription access and creation", () => {
  let fixture: PrescriptionFixture;
  let auth: AuthFixture;
  let appointments: AppointmentFixture;
  let app: express.Express;
  beforeEach(async () => {
    fixture = new PrescriptionFixture();
    auth = new AuthFixture();
    appointments = new AppointmentFixture();
    await auth.addUser("doctor-user", "Doctor");
    await auth.addUser(patientId, "Patient");
    fixture.profiles.set(doctorId, {
      id: doctorId, userId: "doctor-user", givenName: "Sam", familyName: "Rivera",
      specialization: "Cardiology", qualification: "MD", experienceYears: 8, bio: null,
      approvalStatus: "approved", availability: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    });
    appointments.appointments.set(appointmentId, {
      id: appointmentId, patientId, doctorId, startsAt: new Date().toISOString(),
      endsAt: new Date(Date.now() + 1800000).toISOString(), status: "confirmed",
      patientDisplayName: "Synthetic Patient", doctorDisplayName: "Sam Rivera", specialization: "Cardiology"
    });
    app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use(requestIdMiddleware);
    app.use("/api/v1/prescriptions", createPrescriptionRouter(auth, fixture, appointments, fixture, "session"));
    app.use(errorHandler);
  });

  it("requires Doctor role and an assigned confirmed appointment to create prescriptions", async () => {
    const patientToken = await auth.createSession(patientId);
    const denied = await request(app).post("/api/v1/prescriptions/doctor").set("Cookie", `session=${patientToken}`).send({});
    expect(denied.status).toBe(403);
    const doctorToken = await auth.createSession("doctor-user");
    const payload = {
      patientId, appointmentId, medicationName: "Example medication", dosage: "10 mg",
      route: "oral", frequency: "Once daily", durationDays: 7, instructions: "Synthetic test only"
    };
    const created = await request(app).post("/api/v1/prescriptions/doctor").set("Cookie", `session=${doctorToken}`).send(payload);
    expect(created.status).toBe(201);
    expect(created.body.data.prescription).toMatchObject({ patientId, doctorId, medicationName: "Example medication" });

    appointments.appointments.set(appointmentId, { ...appointments.appointments.get(appointmentId)!, status: "cancelled" });
    const invalidLink = await request(app).post("/api/v1/prescriptions/doctor").set("Cookie", `session=${doctorToken}`).send(payload);
    expect(invalidLink.status).toBe(400);
  });

  it("limits patient prescription lists to the authenticated patient", async () => {
    const token = await auth.createSession(patientId);
    const response = await request(app).get("/api/v1/prescriptions/me").set("Cookie", `session=${token}`);
    expect(response.status).toBe(200);
    expect(response.body.data.prescriptions).toEqual([]);
    expect(fixture.audits).toEqual([`${patientId}:${patientId}:${response.body.meta.requestId}`]);
  });
});
