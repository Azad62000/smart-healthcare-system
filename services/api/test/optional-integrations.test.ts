import { beforeEach, describe, expect, it } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import type { AuthRepository, PublicUser, UserRecord, UserRole } from "../src/auth/repository.js";
import { createAiRouter } from "../src/ai/routes.js";
import { createAdminServicesRouter } from "../src/admin/services.js";
import { errorHandler } from "../src/middleware/error-handler.js";
import { requestIdMiddleware } from "../src/middleware/request-id.js";

class IntegrationAuth implements AuthRepository {
  users = new Map<string, PublicUser>();
  sessions = new Map<string, string>();
  async addUser(id: string, role: UserRole) { const user = { id, email: `${id}@example.test`, role, status: "active" as const }; this.users.set(id, user); return user; }
  async createPatient(email: string) { return this.addUser(email, "Patient"); }
  async findByEmail(email: string): Promise<UserRecord | undefined> { const user = [...this.users.values()].find((item) => item.email === email); return user && { ...user, password_hash: "unused" }; }
  async findById(id: string) { return this.users.get(id); }
  async createSession(userId: string) { const token = `session-${userId}`; this.sessions.set(token, userId); return token; }
  async findSession(token: string) { return this.users.get(this.sessions.get(token) ?? ""); }
  async deleteSession(token: string) { this.sessions.delete(token); }
}

describe("optional integration status and unavailable behavior", () => {
  let auth: IntegrationAuth;
  let app: express.Express;
  beforeEach(async () => {
    auth = new IntegrationAuth();
    await auth.addUser("patient", "Patient");
    await auth.addUser("doctor", "Doctor");
    await auth.addUser("admin", "Admin");
    app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use(requestIdMiddleware);
    app.use("/api/v1/ai", createAiRouter(auth, "session"));
    app.use("/api/v1/admin/services", createAdminServicesRouter(auth, async () => undefined, "session"));
    app.use(errorHandler);
  });

  it("reports AI as unconfigured and returns an explicit 503 without producing a result", async () => {
    const token = await auth.createSession("patient");
    const status = await request(app).get("/api/v1/ai/status").set("Cookie", `session=${token}`);
    expect(status.status).toBe(200);
    expect(status.body.data).toMatchObject({ configured: false, service: null });
    const prediction = await request(app).post("/api/v1/ai/predictions").set("Cookie", `session=${token}`).send({ feature: "heart-risk", input: { age: 42 } });
    expect(prediction.status).toBe(503);
    expect(prediction.body.error.code).toBe("AI_SERVICE_NOT_CONFIGURED");
    expect(prediction.body).not.toHaveProperty("data");
  });

  it("restricts service status to Admin and checks the configured database probe", async () => {
    const patientToken = await auth.createSession("patient");
    expect((await request(app).get("/api/v1/admin/services").set("Cookie", `session=${patientToken}`)).status).toBe(403);
    const adminToken = await auth.createSession("admin");
    const response = await request(app).get("/api/v1/admin/services").set("Cookie", `session=${adminToken}`);
    expect(response.status).toBe(200);
    expect(response.body.data.services).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "Healthcare API", status: "healthy" }),
      expect.objectContaining({ name: "PostgreSQL", status: "healthy", detail: "Database query succeeded." }),
      expect.objectContaining({ name: "AI inference", status: "not_configured" })
    ]));
    for (const name of ["SMTP email delivery", "Google sign-in", "Facebook sign-in", "LiveKit video"]) {
      expect(response.body.data.services).toEqual(expect.arrayContaining([expect.objectContaining({ name, status: expect.stringMatching(/^(configured|not_configured)$/) })]));
    }
    expect(JSON.stringify(response.body.data.services)).not.toMatch(/client_secret|api_secret|private_key/i);
  });
});
