import { beforeEach, describe, expect, it } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import type { AuthRepository, PublicUser, UserRecord, UserRole } from "../src/auth/repository.js";
import { createPatientRouter } from "../src/patients/routes.js";
import type { PatientProfile, PatientProfileInput, PatientRepository } from "../src/patients/types.js";
import { errorHandler } from "../src/middleware/error-handler.js";
import { requestIdMiddleware } from "../src/middleware/request-id.js";

class PatientTestRepository implements AuthRepository, PatientRepository {
  users = new Map<string, PublicUser>();
  sessions = new Map<string, string>();
  profiles = new Map<string, PatientProfile>();
  async createPatient(email: string): Promise<PublicUser> { const user = { id: email, email, role: "Patient" as UserRole, status: "active" as const }; this.users.set(email, user); return user; }
  async findByEmail(email: string): Promise<UserRecord | undefined> { const user = this.users.get(email); return user && { ...user, password_hash: "unused" }; }
  async findById(id: string) { return this.users.get(id); }
  async createSession(userId: string) { const token = `token-${userId}`; this.sessions.set(token, userId); return token; }
  async findSession(token: string) { const user = this.users.get(this.sessions.get(token) ?? ""); return user?.status === "active" ? user : undefined; }
  async deleteSession(token: string) { this.sessions.delete(token); }
  async findByUserId(userId: string) { return this.profiles.get(userId); }
  async create(userId: string, profile: PatientProfileInput) { const now = new Date().toISOString(); const result = { userId, ...profile, createdAt: now, updatedAt: now }; this.profiles.set(userId, result); return result; }
  async update(userId: string, profile: PatientProfileInput) { const current = this.profiles.get(userId); if (!current) return undefined; const result = { ...current, ...profile, updatedAt: new Date().toISOString() }; this.profiles.set(userId, result); return result; }
}

function makeApp(repository: PatientTestRepository) {
  const app = express();
  app.use(express.json()); app.use(cookieParser()); app.use(requestIdMiddleware);
  app.use("/api/v1/patients", createPatientRouter(repository, repository, "session"));
  app.use(errorHandler);
  return app;
}

describe("patient profile endpoints", () => {
  let repository: PatientTestRepository; let app: express.Express;
  beforeEach(async () => { repository = new PatientTestRepository(); app = makeApp(repository); await repository.createPatient("p1"); await repository.createPatient("p2"); });
  const profile = { givenName: "Ada", familyName: "Lovelace", dateOfBirth: "1990-01-01", phone: "+1 555 010 1000", addressLine: "1 Main St", city: "London", postalCode: "N1" };

  it("requires an authenticated Patient role", async () => {
    const unauthenticated = await request(app).get("/api/v1/patients/me");
    expect(unauthenticated.status).toBe(401);
    repository.users.set("p1", { id: "p1", email: "p1", role: "Doctor", status: "active" });
    const token = await repository.createSession("p1");
    const doctor = await request(app).get("/api/v1/patients/me").set("Cookie", `session=${token}`);
    expect(doctor.status).toBe(403);
  });

  it("returns incomplete state, creates and updates only the signed-in user's own profile", async () => {
    const token = await repository.createSession("p1");
    const missing = await request(app).get("/api/v1/patients/me").set("Cookie", `session=${token}`);
    expect(missing.body.data).toEqual({ profile: null, complete: false });
    const created = await request(app).put("/api/v1/patients/me").set("Cookie", `session=${token}`).send(profile);
    expect(created.status).toBe(200);
    expect(created.body.data.profile.userId).toBe("p1");
    expect(repository.profiles.has("p2")).toBe(false);
    const updated = await request(app).put("/api/v1/patients/me").set("Cookie", `session=${token}`).send({ ...profile, city: "Oxford" });
    expect(updated.body.data.profile.city).toBe("Oxford");
  });

  it("rejects invalid or client-supplied ownership fields", async () => {
    const token = await repository.createSession("p1");
    const invalid = await request(app).put("/api/v1/patients/me").set("Cookie", `session=${token}`).send({ ...profile, dateOfBirth: "not-a-date" });
    expect(invalid.status).toBe(400);
    const escalated = await request(app).put("/api/v1/patients/me").set("Cookie", `session=${token}`).send({ ...profile, userId: "p2" });
    expect(escalated.status).toBe(400);
    expect(repository.profiles.has("p2")).toBe(false);
  });
});
