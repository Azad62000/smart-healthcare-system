import { beforeEach, describe, expect, it } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import type { AuthRepository, PublicUser, UserRecord, UserRole } from "../src/auth/repository.js";
import { createAdminUserRouter } from "../src/admin/users.js";
import { AdminUserService } from "../src/admin/users.js";
import type { AdminUserRepository } from "../src/admin/users.js";
import { ApiRequestError } from "../src/request-error.js";
import { errorHandler } from "../src/middleware/error-handler.js";
import { requestIdMiddleware } from "../src/middleware/request-id.js";

type ManagedUser = { id: string; email: string; role: UserRole; status: "active" | "inactive" | "locked"; createdAt: string };

class AdminFixture implements AuthRepository, AdminUserRepository {
  users = new Map<string, ManagedUser>();
  sessions = new Map<string, string>();
  auditEvents: Array<{ actorId: string; targetId: string; before: string; after: string; requestId: string }> = [];
  async addUser(id: string, role: UserRole, status: ManagedUser["status"] = "active") {
    const user = { id, email: `${id}@example.test`, role, status, createdAt: "2030-01-01T00:00:00.000Z" };
    this.users.set(id, user);
    return user;
  }
  async createPatient(email: string) { return this.addUser(email, "Patient"); }
  async findByEmail(email: string): Promise<UserRecord | undefined> {
    const user = [...this.users.values()].find((candidate) => candidate.email === email);
    return user && { ...user, password_hash: "unused" };
  }
  async findById(id: string): Promise<PublicUser | undefined> {
    const user = this.users.get(id);
    return user && { id: user.id, email: user.email, role: user.role, status: user.status };
  }
  async createSession(userId: string) { const token = `session-${userId}`; this.sessions.set(token, userId); return token; }
  async findSession(token: string) { return this.findById(this.sessions.get(token) ?? ""); }
  async deleteSession(token: string) { this.sessions.delete(token); }
  async list(filters: { search?: string; role?: UserRole; status?: ManagedUser["status"] }) {
    return [...this.users.values()].filter((user) =>
      (!filters.search || user.email.toLowerCase().includes(filters.search.toLowerCase())) &&
      (!filters.role || user.role === filters.role) &&
      (!filters.status || user.status === filters.status)
    );
  }
  async setStatus(id: string, status: ManagedUser["status"], actorId: string, _requestId: string) {
    if (id === actorId && status !== "active") {
      throw new ApiRequestError(400, "CANNOT_DEACTIVATE_SELF", "You cannot deactivate or lock your own account.");
    }
    const user = this.users.get(id);
    if (!user) return undefined;
    if (user.role === "Admin" && user.status === "active" && status !== "active" &&
        [...this.users.values()].filter((item) => item.role === "Admin" && item.status === "active").length <= 1) {
      throw new ApiRequestError(409, "LAST_ACTIVE_ADMIN", "The last active administrator cannot be deactivated.");
    }
    const updated = { ...user, status };
    this.users.set(id, updated);
    this.auditEvents.push({ actorId, targetId: id, before: user.status, after: status, requestId: _requestId });
    return updated;
  }
}

describe("Admin user management", () => {
  let fixture: AdminFixture;
  let app: express.Express;
  beforeEach(() => {
    fixture = new AdminFixture();
    app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use(requestIdMiddleware);
    app.use("/api/v1/admin/users", createAdminUserRouter(fixture, fixture, "session"));
    app.use(errorHandler);
  });

  it("allows only Admins to list users and applies filters without returning credentials", async () => {
    await fixture.addUser("admin", "Admin");
    await fixture.addUser("patient", "Patient");
    const patientToken = await fixture.createSession("patient");
    expect((await request(app).get("/api/v1/admin/users").set("Cookie", `session=${patientToken}`)).status).toBe(403);
    const adminToken = await fixture.createSession("admin");
    const response = await request(app).get("/api/v1/admin/users?role=Patient&status=active").set("Cookie", `session=${adminToken}`);
    expect(response.status).toBe(200);
    expect(response.body.data.users).toHaveLength(1);
    expect(response.body.data.users[0]).toMatchObject({ id: "patient", role: "Patient", status: "active" });
    expect(JSON.stringify(response.body)).not.toMatch(/password|token/i);
  });

  it("prevents self-deactivation and deactivation of the last active Admin", async () => {
    const adminId = "11111111-1111-4111-8111-111111111111";
    await fixture.addUser(adminId, "Admin");
    const adminToken = await fixture.createSession(adminId);
    const self = await request(app).patch(`/api/v1/admin/users/${adminId}/status`).set("Cookie", `session=${adminToken}`).send({ status: "inactive" });
    expect(self.status).toBe(400);
    const lastAdmin = await new AdminUserService(fixture).setStatus(adminId, "inactive", { id: "other-admin", email: "other@example.test", role: "Admin", status: "active" }, "request-id")
      .then(() => undefined, (error: { code?: string }) => error.code);
    expect(lastAdmin).toBe("LAST_ACTIVE_ADMIN");
  });

  it("updates account status and records the authenticated actor and request ID", async () => {
    const adminId = "11111111-1111-4111-8111-111111111111";
    const patientId = "22222222-2222-4222-8222-222222222222";
    await fixture.addUser(adminId, "Admin");
    await fixture.addUser(patientId, "Patient");
    const token = await fixture.createSession(adminId);
    const response = await request(app).patch(`/api/v1/admin/users/${patientId}/status`)
      .set("Cookie", `session=${token}`).send({ status: "locked" });
    expect(response.status).toBe(200);
    expect(response.body.data.user).toMatchObject({ id: patientId, status: "locked" });
    expect(fixture.auditEvents).toEqual([{
      actorId: adminId,
      targetId: patientId,
      before: "active",
      after: "locked",
      requestId: response.body.meta.requestId
    }]);
  });
});
