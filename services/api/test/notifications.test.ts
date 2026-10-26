import { beforeEach, describe, expect, it } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import type { AuthRepository, PublicUser, UserRecord, UserRole } from "../src/auth/repository.js";
import { createNotificationRouter } from "../src/notifications/routes.js";
import type { Notification, NotificationRepository } from "../src/notifications/types.js";
import { errorHandler } from "../src/middleware/error-handler.js";
import { requestIdMiddleware } from "../src/middleware/request-id.js";

class NotificationTestRepository implements AuthRepository, NotificationRepository {
  users = new Map<string, PublicUser>();
  sessions = new Map<string, string>();
  notifications: Array<Notification & { recipientId: string }> = [];

  async addUser(id: string, role: UserRole) { const user = { id, email: `${id}@example.test`, role, status: "active" as const }; this.users.set(id, user); return user; }
  async createPatient(email: string) { return this.addUser(email, "Patient"); }
  async findByEmail(email: string): Promise<UserRecord | undefined> { const user = [...this.users.values()].find((item) => item.email === email); return user && { ...user, password_hash: "unused" }; }
  async findById(id: string) { return this.users.get(id); }
  async createSession(userId: string) { const token = `session-${userId}`; this.sessions.set(token, userId); return token; }
  async findSession(token: string) { const user = this.users.get(this.sessions.get(token) ?? ""); return user?.status === "active" ? user : undefined; }
  async deleteSession(token: string) { this.sessions.delete(token); }
  async listForUser(userId: string) { return this.notifications.filter((item) => item.recipientId === userId).map(({ recipientId: _recipientId, ...notification }) => notification); }
  async markReadForUser(id: string, userId: string) {
    const item = this.notifications.find((notification) => notification.id === id && notification.recipientId === userId);
    if (!item) return undefined;
    item.readAt ??= new Date().toISOString();
    const { recipientId: _recipientId, ...notification } = item;
    return notification;
  }
}

function makeApp(repository: NotificationTestRepository) {
  const app = express(); app.use(express.json()); app.use(cookieParser()); app.use(requestIdMiddleware);
  app.use("/api/v1/notifications", createNotificationRouter(repository, repository, "session")); app.use(errorHandler); return app;
}

describe("Notification Service", () => {
  let repository: NotificationTestRepository;
  let app: express.Express;
  const notificationId = "22222222-2222-4222-8222-222222222222";
  beforeEach(async () => {
    repository = new NotificationTestRepository(); app = makeApp(repository);
    await repository.addUser("patient1", "Patient"); await repository.addUser("patient2", "Patient");
    repository.notifications.push({ id: notificationId, recipientId: "patient1", eventType: "created", appointmentId: "33333333-3333-4333-8333-333333333333", title: "Appointment booked", message: "An appointment has been booked.", createdAt: new Date().toISOString(), readAt: null });
  });

  it("requires authentication and lists only the signed-in user's notifications", async () => {
    expect((await request(app).get("/api/v1/notifications/me")).status).toBe(401);
    const token = await repository.createSession("patient2");
    const response = await request(app).get("/api/v1/notifications/me").set("Cookie", `session=${token}`);
    expect(response.status).toBe(200); expect(response.body.data.notifications).toEqual([]); expect(response.body.data.unreadCount).toBe(0);
  });

  it("marks a notification as read idempotently and hides another user's notification", async () => {
    const other = await repository.createSession("patient2");
    const hidden = await request(app).patch(`/api/v1/notifications/${notificationId}/read`).set("Cookie", `session=${other}`);
    expect(hidden.status).toBe(404);
    const owner = await repository.createSession("patient1");
    const first = await request(app).patch(`/api/v1/notifications/${notificationId}/read`).set("Cookie", `session=${owner}`);
    const second = await request(app).patch(`/api/v1/notifications/${notificationId}/read`).set("Cookie", `session=${owner}`);
    expect(first.status).toBe(200); expect(second.status).toBe(200); expect(second.body.data.notification.readAt).toBe(first.body.data.notification.readAt);
  });
});
