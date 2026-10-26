import { beforeEach, describe, expect, it } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import type { AuthRepository, PublicUser, UserRecord, UserRole } from "../src/auth/repository.js";
import { createDoctorRouter } from "../src/doctors/routes.js";
import type { DoctorApprovalStatus, DoctorAvailability, DoctorProfile, DoctorProfileInput, DoctorRepository } from "../src/doctors/types.js";
import { errorHandler } from "../src/middleware/error-handler.js";
import { requestIdMiddleware } from "../src/middleware/request-id.js";

class DoctorTestRepository implements AuthRepository, DoctorRepository {
  users = new Map<string, PublicUser>(); sessions = new Map<string, string>(); profiles = new Map<string, DoctorProfile>();
  async addUser(id: string, role: UserRole): Promise<PublicUser> { const user = { id, email: `${id}@example.test`, role, status: "active" as const }; this.users.set(id, user); return user; }
  async createPatient(email: string) { return this.addUser(email, "Patient"); }
  async findByEmail(email: string): Promise<UserRecord | undefined> { const user = [...this.users.values()].find((entry) => entry.email === email); return user && { ...user, password_hash: "unused" }; }
  async findById(id: string) { return this.users.get(id); }
  async createSession(userId: string) { const token = `session-${userId}`; this.sessions.set(token, userId); return token; }
  async findSession(token: string) { const user = this.users.get(this.sessions.get(token) ?? ""); return user?.status === "active" ? user : undefined; }
  async deleteSession(token: string) { this.sessions.delete(token); }
  async listApproved(specialization?: string) { return [...this.profiles.values()].filter((doctor) => doctor.approvalStatus === "approved" && (!specialization || doctor.specialization.toLowerCase() === specialization.toLowerCase())); }
  async listPending() { return [...this.profiles.values()].filter((doctor) => doctor.approvalStatus === "pending").sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)).slice(0, 100); }
  async findPublicById(id: string) { const doctor = this.profiles.get(id); return doctor?.approvalStatus === "approved" ? doctor : undefined; }
  async findByUserId(userId: string) { return [...this.profiles.values()].find((doctor) => doctor.userId === userId); }
  async saveProfile(userId: string, profile: DoctorProfileInput) {
    const previous = await this.findByUserId(userId); const now = new Date().toISOString();
    const doctor: DoctorProfile = { id: previous?.id ?? (userId === "doc1" ? "11111111-1111-4111-8111-111111111111" : "22222222-2222-4222-8222-222222222222"), userId, ...profile, approvalStatus: previous?.approvalStatus === "approved" ? "pending" : previous?.approvalStatus ?? "pending", availability: previous?.availability ?? [], createdAt: previous?.createdAt ?? now, updatedAt: now };
    this.profiles.set(doctor.id, doctor); return doctor;
  }
  async setApprovalStatus(id: string, status: DoctorApprovalStatus) { const doctor = this.profiles.get(id); if (!doctor) return undefined; const updated = { ...doctor, approvalStatus: status }; this.profiles.set(id, updated); return updated; }
  async replaceAvailability(userId: string, slots: Array<{ startsAt: string; endsAt: string }>): Promise<DoctorAvailability[]> { const doctor = await this.findByUserId(userId); if (!doctor) throw new Error("profile required"); const availability = slots.map((slot, index) => ({ id: `${doctor.id}-${index}`, ...slot })); this.profiles.set(doctor.id, { ...doctor, availability }); return availability; }
}

function makeApp(repository: DoctorTestRepository) {
  const app = express(); app.use(express.json()); app.use(cookieParser()); app.use(requestIdMiddleware);
  app.use("/api/v1/doctors", createDoctorRouter(repository, repository, "session")); app.use(errorHandler); return app;
}

describe("Doctor Service", () => {
  let repository: DoctorTestRepository; let app: express.Express;
  const profile = { givenName: "Sam", familyName: "Rivera", specialization: "Cardiology", qualification: "MD", experienceYears: 8, bio: "Clinical care" };
  beforeEach(() => { repository = new DoctorTestRepository(); app = makeApp(repository); });

  it("only lists approved profiles and supports specialization filters", async () => {
    await repository.addUser("doc1", "Doctor"); await repository.addUser("doc2", "Doctor");
    await repository.saveProfile("doc1", profile); await repository.saveProfile("doc2", { ...profile, specialization: "Neurology" });
    await repository.setApprovalStatus("11111111-1111-4111-8111-111111111111", "approved"); await repository.setApprovalStatus("22222222-2222-4222-8222-222222222222", "pending");
    const all = await request(app).get("/api/v1/doctors/directory");
    expect(all.body.data.doctors.map((item: DoctorProfile) => item.id)).toEqual(["11111111-1111-4111-8111-111111111111"]);
    expect(all.body.data.doctors[0]).not.toHaveProperty("userId");
    const filtered = await request(app).get("/api/v1/doctors/directory?specialization=Cardiology");
    expect(filtered.body.data.doctors).toHaveLength(1);
  });

  it("lists pending profiles to Admin without exposing account IDs and removes decisions from the queue", async () => {
    await repository.addUser("doc1", "Doctor");
    await repository.saveProfile("doc1", profile);
    await repository.addUser("patient1", "Patient");
    const patientToken = await repository.createSession("patient1");
    const denied = await request(app).get("/api/v1/doctors/pending").set("Cookie", `session=${patientToken}`);
    expect(denied.status).toBe(403);

    await repository.addUser("admin1", "Admin");
    const adminToken = await repository.createSession("admin1");
    const pending = await request(app).get("/api/v1/doctors/pending").set("Cookie", `session=${adminToken}`);
    expect(pending.status).toBe(200);
    expect(pending.body.data.doctors).toHaveLength(1);
    expect(pending.body.data.doctors[0]).toMatchObject({ id: "11111111-1111-4111-8111-111111111111", approvalStatus: "pending", givenName: "Sam" });
    expect(pending.body.data.doctors[0]).not.toHaveProperty("userId");

    const decision = await request(app).patch("/api/v1/doctors/11111111-1111-4111-8111-111111111111/approval").set("Cookie", `session=${adminToken}`).send({ status: "approved" });
    expect(decision.status).toBe(200);
    const refreshed = await request(app).get("/api/v1/doctors/pending").set("Cookie", `session=${adminToken}`);
    expect(refreshed.body.data.doctors).toHaveLength(0);
  });

  it("requires Doctor role and restricts profile edits to the session owner", async () => {
    await repository.addUser("patient1", "Patient");
    const patientToken = await repository.createSession("patient1");
    const forbidden = await request(app).put("/api/v1/doctors/me").set("Cookie", `session=${patientToken}`).send(profile);
    expect(forbidden.status).toBe(403);
    await repository.addUser("doc1", "Doctor");
    const token = await repository.createSession("doc1");
    const created = await request(app).put("/api/v1/doctors/me").set("Cookie", `session=${token}`).send(profile);
    expect(created.status).toBe(200); expect(created.body.data.profile.userId).toBe("doc1");
    const escalated = await request(app).put("/api/v1/doctors/me").set("Cookie", `session=${token}`).send({ ...profile, userId: "patient1", approvalStatus: "approved" });
    expect(escalated.status).toBe(400);
  });

  it("limits approval decisions to Admin and validates future non-overlapping availability", async () => {
    await repository.addUser("doc1", "Doctor"); const doctorToken = await repository.createSession("doc1");
    await repository.saveProfile("doc1", profile);
    const futureStart = new Date(Date.now() + 3600_000); const futureEnd = new Date(futureStart.getTime() + 3600_000);
    const availability = await request(app).put("/api/v1/doctors/me/availability").set("Cookie", `session=${doctorToken}`).send({ slots: [{ startsAt: futureStart.toISOString(), endsAt: futureEnd.toISOString() }] });
    expect(availability.status).toBe(200); expect(availability.body.data.availability).toHaveLength(1);
    const overlapping = await request(app).put("/api/v1/doctors/me/availability").set("Cookie", `session=${doctorToken}`).send({ slots: [{ startsAt: futureStart.toISOString(), endsAt: futureEnd.toISOString() }, { startsAt: futureStart.toISOString(), endsAt: futureEnd.toISOString() }] });
    expect(overlapping.status).toBe(400);
    const approval = await request(app).patch("/api/v1/doctors/11111111-1111-4111-8111-111111111111/approval").set("Cookie", `session=${doctorToken}`).send({ status: "approved" });
    expect(approval.status).toBe(403);
  });
});
