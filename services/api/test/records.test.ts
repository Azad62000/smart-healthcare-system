import { beforeEach, describe, expect, it } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import type { AuthRepository, PublicUser, UserRecord, UserRole } from "../src/auth/repository.js";
import type { Appointment, AppointmentRepository, AppointmentStatus, AvailableSlot } from "../src/appointments/types.js";
import type { DoctorProfile, DoctorProfileInput, DoctorRepository, DoctorAvailability, DoctorApprovalStatus } from "../src/doctors/types.js";
import { createRecordRouter } from "../src/records/routes.js";
import type { ConsultationInput, ConsultationRecord, RecordRepository } from "../src/records/types.js";
import { requestIdMiddleware } from "../src/middleware/request-id.js";
import { errorHandler } from "../src/middleware/error-handler.js";

class AuthStub implements AuthRepository {
  users = new Map<string, PublicUser>(); sessions = new Map<string, string>();
  async addUser(id: string, role: UserRole) { const user = { id, email: `${id}@test`, role, status: "active" as const }; this.users.set(id, user); return user; }
  async createPatient(email: string) { return this.addUser(email, "Patient"); }
  async findByEmail(email: string): Promise<UserRecord | undefined> { const user = [...this.users.values()].find((entry) => entry.email === email); return user && { ...user, password_hash: "x" }; }
  async findById(id: string) { return this.users.get(id); }
  async createSession(userId: string) { const token = `s-${userId}`; this.sessions.set(token, userId); return token; }
  async findSession(token: string) { const user = this.users.get(this.sessions.get(token) ?? ""); return user?.status === "active" ? user : undefined; }
  async deleteSession(token: string) { this.sessions.delete(token); }
}
class DoctorStub implements DoctorRepository {
  doctors = new Map<string, DoctorProfile>();
  async listApproved() { return [...this.doctors.values()].filter((d) => d.approvalStatus === "approved"); }
  async listPending() { return [...this.doctors.values()].filter((d) => d.approvalStatus === "pending"); }
  async findPublicById(id: string) { const d = this.doctors.get(id); return d?.approvalStatus === "approved" ? d : undefined; }
  async findByUserId(userId: string) { return [...this.doctors.values()].find((d) => d.userId === userId); }
  async saveProfile(userId: string, input: DoctorProfileInput) { const now = new Date().toISOString(); const d: DoctorProfile = { id: `doctor-${userId}`, userId, ...input, approvalStatus: "approved", availability: [], createdAt: now, updatedAt: now }; this.doctors.set(d.id, d); return d; }
  async setApprovalStatus(id: string, status: DoctorApprovalStatus) { const d = this.doctors.get(id); if (!d) return undefined; const next = { ...d, approvalStatus: status }; this.doctors.set(id, next); return next; }
  async replaceAvailability(): Promise<DoctorAvailability[]> { return []; }
}
class AppointmentStub implements AppointmentRepository {
  appointments: Appointment[] = [];
  async listAvailableSlots(): Promise<AvailableSlot[]> { return []; }
  async create(): Promise<Appointment> { throw new Error("unused"); }
  async listForPatient(patientId: string) { return this.appointments.filter((a) => a.patientId === patientId); }
  async listForDoctor(doctorId: string) { return this.appointments.filter((a) => a.doctorId === doctorId); }
  async findDoctorIdByUserId(userId: string) { return `doctor-${userId}`; }
  async findForActor(id: string, actorId: string, role: "Patient" | "Doctor" | "Admin") { return this.appointments.find((a) => a.id === id && (role === "Admin" || (role === "Patient" ? a.patientId === actorId : a.doctorId === `doctor-${actorId}`))); }
  async findById(id: string) { return this.appointments.find((a) => a.id === id); }
  async hasCareRelationship(doctorId: string, patientId: string) { return this.appointments.some((a) => a.doctorId === doctorId && a.patientId === patientId && ["confirmed", "completed"].includes(a.status)); }
  async cancel(): Promise<Appointment | undefined> { return undefined; }
  async transition(): Promise<Appointment | undefined> { return undefined; }
}
class RecordStub implements RecordRepository {
  records: ConsultationRecord[] = []; audits: Array<{ actor: string; patient: string; recordId: string | null; action: string; requestId: string }> = [];
  constructor(private readonly doctors: DoctorStub) {}
  async listForPatient(patientId: string) { return this.records.filter((r) => r.patientId === patientId); }
  async listForDoctor(doctorId: string, patientId?: string) { return this.records.filter((r) => r.doctorId === doctorId && (!patientId || r.patientId === patientId)); }
  async findForPatient(recordId: string, patientId: string) { return this.records.find((r) => r.id === recordId && r.patientId === patientId); }
  async create(doctorId: string, input: ConsultationInput, actorUserId: string, requestId: string) { const doctor = this.doctors.doctors.get(doctorId)!; const record: ConsultationRecord = { id: `00000000-0000-4000-8000-${String(this.records.length + 1).padStart(12, "0")}`, patientId: input.patientId, doctorId, appointmentId: input.appointmentId ?? null, consultationAt: input.consultationAt ?? new Date().toISOString(), note: input.note, diagnosis: input.diagnosis ?? null, doctorDisplayName: `${doctor.givenName} ${doctor.familyName}`, specialization: doctor.specialization, createdAt: new Date().toISOString() }; this.records.push(record); await this.audit(actorUserId, input.patientId, record.id, "create", requestId); return record; }
  async audit(actorUserId: string, patientId: string, recordId: string | null, action: "list" | "read" | "create", requestId: string) { this.audits.push({ actor: actorUserId, patient: patientId, recordId, action, requestId }); }
}

describe("Health Record Service access and audit", () => {
  let auth: AuthStub; let doctors: DoctorStub; let appointments: AppointmentStub; let records: RecordStub; let app: express.Express;
  beforeEach(async () => {
    auth = new AuthStub(); doctors = new DoctorStub(); appointments = new AppointmentStub(); records = new RecordStub(doctors);
    await auth.addUser("11111111-1111-4111-8111-111111111111", "Patient"); await auth.addUser("22222222-2222-4222-8222-222222222222", "Patient"); await auth.addUser("d1", "Doctor"); await auth.addUser("d2", "Doctor");
    await doctors.saveProfile("d1", { givenName: "Doctor", familyName: "One", specialization: "Family Medicine", qualification: null, experienceYears: null, bio: null });
    await doctors.saveProfile("d2", { givenName: "Doctor", familyName: "Two", specialization: "Family Medicine", qualification: null, experienceYears: null, bio: null });
    appointments.appointments.push({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", patientId: "11111111-1111-4111-8111-111111111111", doctorId: "doctor-d1", startsAt: new Date().toISOString(), endsAt: new Date(Date.now() + 3600_000).toISOString(), status: "confirmed", patientDisplayName: "11111111-1111-4111-8111-111111111111", doctorDisplayName: "d1", specialization: "Family Medicine" });
    app = express(); app.use(express.json()); app.use(cookieParser()); app.use(requestIdMiddleware); app.use("/api/v1/records", createRecordRouter(auth, records, appointments, doctors, "session")); app.use(errorHandler);
  });
  it("allows the assigned approved Doctor to create and read records and audits metadata only", async () => {
    const token = await auth.createSession("d1");
    const created = await request(app).post("/api/v1/records/doctor").set("Cookie", `session=${token}`).send({ patientId: "11111111-1111-4111-8111-111111111111", appointmentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", diagnosis: "Hypertension", note: "Follow-up plan." });
    expect(created.status).toBe(201);
    const list = await request(app).get("/api/v1/records/doctor?patientId=11111111-1111-4111-8111-111111111111").set("Cookie", `session=${token}`);
    expect(list.status).toBe(200); expect(list.body.data.records).toHaveLength(1);
    expect(records.audits.map((event) => event.action)).toEqual(["create", "list"]);
    expect(JSON.stringify(records.audits)).not.toContain("Follow-up plan");
  });
  it("restricts patients to their own records and hides records from unrelated doctors", async () => {
    const doctorToken = await auth.createSession("d1");
    const created = await request(app).post("/api/v1/records/doctor").set("Cookie", `session=${doctorToken}`).send({ patientId: "11111111-1111-4111-8111-111111111111", note: "Private note" });
    const p2Token = await auth.createSession("22222222-2222-4222-8222-222222222222");
    const hidden = await request(app).get(`/api/v1/records/me/${created.body.data.record.id}`).set("Cookie", `session=${p2Token}`);
    expect(hidden.status).toBe(404);
    const d2Token = await auth.createSession("d2");
    const unrelated = await request(app).get("/api/v1/records/doctor?patientId=11111111-1111-4111-8111-111111111111").set("Cookie", `session=${d2Token}`);
    expect(unrelated.status).toBe(403);
  });
  it("requires a care relationship and validates appointment linkage", async () => {
    const token = await auth.createSession("d1");
    const unrelated = await request(app).post("/api/v1/records/doctor").set("Cookie", `session=${token}`).send({ patientId: "22222222-2222-4222-8222-222222222222", note: "Not authorized" });
    expect(unrelated.status).toBe(403);
    const mismatched = await request(app).post("/api/v1/records/doctor").set("Cookie", `session=${token}`).send({ patientId: "11111111-1111-4111-8111-111111111111", appointmentId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", note: "Not linked" });
    expect(mismatched.status).toBe(400);
  });
});
