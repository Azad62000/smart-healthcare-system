import { beforeEach, describe, expect, it } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import type { AuthRepository, PublicUser, UserRecord, UserRole } from "../src/auth/repository.js";
import { createAnalyticsRouter } from "../src/analytics/routes.js";
import type { AnalyticsOverview, AnalyticsRepository } from "../src/analytics/types.js";
import { errorHandler } from "../src/middleware/error-handler.js";
import { requestIdMiddleware } from "../src/middleware/request-id.js";

class AnalyticsFixtureRepository implements AuthRepository, AnalyticsRepository {
  users = new Map<string, PublicUser>();
  sessions = new Map<string, string>();
  now = new Date("2026-02-01T00:00:00.000Z");
  overview: AnalyticsOverview = {
    patientCount: 12,
    approvedDoctorCount: 4,
    appointmentCount: 9,
    appointmentsByStatus: [
      { status: "booked", count: 2 }, { status: "cancelled", count: 1 },
      { status: "completed", count: 3 }, { status: "confirmed", count: 2 }, { status: "no_show", count: 1 }
    ],
    pendingAppointmentCount: 2,
    upcomingAppointmentCount: 3,
    generatedAt: "2026-02-01T00:00:00.000Z"
  };
  async addUser(id: string, role: UserRole) { const user = { id, email: `${id}@example.test`, role, status: "active" as const }; this.users.set(id, user); return user; }
  async createPatient(email: string) { return this.addUser(email, "Patient"); }
  async findByEmail(email: string): Promise<UserRecord | undefined> { const user = [...this.users.values()].find((item) => item.email === email); return user && { ...user, password_hash: "unused" }; }
  async findById(id: string) { return this.users.get(id); }
  async createSession(userId: string) { const token = `session-${userId}`; this.sessions.set(token, userId); return token; }
  async findSession(token: string) { const user = this.users.get(this.sessions.get(token) ?? ""); return user?.status === "active" ? user : undefined; }
  async deleteSession(token: string) { this.sessions.delete(token); }
  async getOverview(now: Date) { return { ...this.overview, generatedAt: now.toISOString() }; }
}

function makeApp(repository: AnalyticsFixtureRepository) {
  const app = express(); app.use(express.json()); app.use(cookieParser()); app.use(requestIdMiddleware);
  app.use("/api/v1/analytics", createAnalyticsRouter(repository, repository, "session")); app.use(errorHandler); return app;
}

describe("Admin analytics", () => {
  let repository: AnalyticsFixtureRepository;
  let app: express.Express;
  beforeEach(async () => {
    repository = new AnalyticsFixtureRepository(); app = makeApp(repository);
    await repository.addUser("admin1", "Admin"); await repository.addUser("patient1", "Patient"); await repository.addUser("doctor1", "Doctor");
  });

  it("requires an authenticated Admin role", async () => {
    expect((await request(app).get("/api/v1/analytics/overview")).status).toBe(401);
    const patientToken = await repository.createSession("patient1");
    const denied = await request(app).get("/api/v1/analytics/overview").set("Cookie", `session=${patientToken}`);
    expect(denied.status).toBe(403);
    const doctorToken = await repository.createSession("doctor1");
    expect((await request(app).get("/api/v1/analytics/overview").set("Cookie", `session=${doctorToken}`)).status).toBe(403);
  });

  it("returns aggregate fixture counts to Admin without patient or clinical details", async () => {
    const token = await repository.createSession("admin1");
    const response = await request(app).get("/api/v1/analytics/overview").set("Cookie", `session=${token}`);
    expect(response.status).toBe(200);
    expect(response.body.data.overview).toMatchObject({ patientCount: 12, approvedDoctorCount: 4, appointmentCount: 9, pendingAppointmentCount: 2, upcomingAppointmentCount: 3 });
    expect(response.body.data.overview.appointmentsByStatus.reduce((total: number, row: { count: number }) => total + row.count, 0)).toBe(9);
    const payload = JSON.stringify(response.body);
    expect(payload).not.toContain("patientId"); expect(payload).not.toContain("diagnosis"); expect(payload).not.toContain("note");
  });
});
