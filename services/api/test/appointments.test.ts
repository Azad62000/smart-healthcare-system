import { beforeEach, describe, expect, it } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import type { AuthRepository, PublicUser, UserRecord, UserRole } from "../src/auth/repository.js";
import { createAppointmentRouter } from "../src/appointments/routes.js";
import type { Appointment, AppointmentRepository, AppointmentStatus, AvailableSlot } from "../src/appointments/types.js";
import { errorHandler } from "../src/middleware/error-handler.js";
import { requestIdMiddleware } from "../src/middleware/request-id.js";

class AppointmentTestRepository implements AppointmentRepository {
  users = new Map<string, PublicUser>(); sessions = new Map<string, string>(); doctors = new Map<string, string>(); doctorApproval = new Map<string, string>();
  slots: Array<{ doctorId: string; startsAt: string; endsAt: string }> = [];
  appointments: Appointment[] = []; private mutex = Promise.resolve();
  notifications: Array<{ userId: string; key: string; event: string }> = [];
  async addUser(id: string, role: UserRole): Promise<PublicUser> { const user = { id, email: `${id}@example.test`, role, status: "active" as const }; this.users.set(id, user); return user; }
  async createSession(userId: string) { const token = `session-${userId}`; this.sessions.set(token, userId); return token; }
  get authRepository(): AuthRepository {
    return {
      createPatient: async (email: string) => this.addUser(email, "Patient"),
      findByEmail: async (email: string): Promise<UserRecord | undefined> => {
        const user = [...this.users.values()].find((entry) => entry.email === email);
        return user && { ...user, password_hash: "unused" };
      },
      findById: async (id: string) => this.users.get(id),
      createSession: async (userId: string) => this.createSession(userId),
      findSession: async (token: string) => {
        const user = this.users.get(this.sessions.get(token) ?? "");
        return user?.status === "active" ? user : undefined;
      },
      deleteSession: async (token: string) => { this.sessions.delete(token); }
    };
  }
  async listAvailableSlots(doctorId: string, from: string, to: string): Promise<AvailableSlot[]> { return this.slots.filter((slot) => slot.doctorId === doctorId && slot.startsAt >= from && slot.endsAt <= to && !this.appointments.some((appointment) => appointment.doctorId === doctorId && ["booked", "confirmed"].includes(appointment.status) && appointment.startsAt < slot.endsAt && appointment.endsAt > slot.startsAt)).map(({ startsAt, endsAt }) => ({ startsAt, endsAt })); }
  async create(patientId: string, doctorId: string, startsAt: string, endsAt: string): Promise<Appointment> {
    if (this.doctorApproval.get(doctorId) !== "approved") throw Object.assign(new Error("doctor is not approved"), { code: "DOCTOR_NOT_APPROVED" });
    let release!: () => void; const prior = this.mutex; this.mutex = new Promise<void>((resolve) => { release = resolve; }); await prior;
    try {
      if (this.appointments.some((appointment) => ["booked", "confirmed"].includes(appointment.status) && ((appointment.doctorId === doctorId || appointment.patientId === patientId) && appointment.startsAt < endsAt && appointment.endsAt > startsAt))) throw Object.assign(new Error("overlap"), { code: "23P01" });
      const sequence = String(this.appointments.length + 1).padStart(12, "0");
      const appointment: Appointment = { id: `00000000-0000-4000-8000-${sequence}`, patientId, doctorId, startsAt, endsAt, status: "booked", patientDisplayName: this.users.get(patientId)?.email ?? "Patient", doctorDisplayName: this.users.get(this.doctors.get(doctorId) ?? "")?.email ?? "Doctor", specialization: "Cardiology" };
    this.appointments.push(appointment); this.notify(appointment, "created"); return appointment;
    } finally { release(); }
  }
  async listForPatient(patientId: string, from?: string, to?: string) { return this.appointments.filter((item) => item.patientId === patientId && (!from || item.startsAt >= from) && (!to || item.startsAt < to)); }
  async listForDoctor(doctorId: string) { return this.appointments.filter((item) => item.doctorId === doctorId); }
  async findDoctorIdByUserId(userId: string) { return [...this.doctors.entries()].find(([, owner]) => owner === userId)?.[0]; }
  async findForActor(id: string, actorId: string, role: "Patient" | "Doctor" | "Admin") { return this.appointments.find((item) => item.id === id && (role === "Admin" || role === "Patient" && item.patientId === actorId || role === "Doctor" && this.doctors.get(item.doctorId) === actorId)); }
  async findById(id: string) { return this.appointments.find((item) => item.id === id); }
  async hasCareRelationship(doctorId: string, patientId: string) { return this.appointments.some((item) => item.doctorId === doctorId && item.patientId === patientId && ["confirmed", "completed"].includes(item.status)); }
  async cancel(id: string, actor: string, role: "Patient" | "Doctor", _reason?: string) { const found = this.appointments.find((item) => item.id === id && ["booked", "confirmed"].includes(item.status) && (role === "Patient" ? item.patientId === actor : this.doctors.get(item.doctorId) === actor)); if (!found) return undefined; found.status = "cancelled"; this.notify(found, "cancelled"); return found; }
  async transition(id: string, _actor: string, status: AppointmentStatus) { const found = this.appointments.find((item) => item.id === id); if (!found) return undefined; found.status = status; this.notify(found, "status_changed"); return found; }
  private notify(appointment: Appointment, event: string) { for (const userId of [appointment.patientId, this.doctors.get(appointment.doctorId)]) if (userId && !this.notifications.some((item) => item.key === `${appointment.id}:${event}` && item.userId === userId)) this.notifications.push({ userId, key: `${appointment.id}:${event}`, event }); }
}

function makeApp(repository: AppointmentTestRepository) { const app = express(); app.use(express.json()); app.use(cookieParser()); app.use(requestIdMiddleware); app.use("/api/v1/appointments", createAppointmentRouter(repository.authRepository, repository, "session")); app.use(errorHandler); return app; }

describe("Appointment Service", () => {
  let repository: AppointmentTestRepository; let app: express.Express;
  const doctorId = "11111111-1111-4111-8111-111111111111";
  const startsAt = new Date(Date.now() + 2 * 3600_000).toISOString(); const endsAt = new Date(Date.now() + 3 * 3600_000).toISOString();
  beforeEach(async () => { repository = new AppointmentTestRepository(); app = makeApp(repository); await repository.addUser("patient1", "Patient"); await repository.addUser("patient2", "Patient"); await repository.addUser("doctor1", "Doctor"); repository.doctors.set(doctorId, "doctor1"); repository.doctorApproval.set(doctorId, "approved"); repository.slots.push({ doctorId, startsAt, endsAt }); });

  it("completes available-slot lookup, booking, patient list, and doctor queue flow", async () => {
    const patientToken = await repository.createSession("patient1"); const doctorToken = await repository.createSession("doctor1");
    const from = new Date(Date.now()).toISOString(); const to = new Date(Date.now() + 86400_000).toISOString();
    const slots = await request(app).get(`/api/v1/appointments/available-slots?doctorId=${doctorId}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&timeZone=Asia%2FKolkata`);
    expect(slots.status).toBe(200); expect(slots.body.data.slots).toHaveLength(1);
    const booking = await request(app).post("/api/v1/appointments").set("Cookie", `session=${patientToken}`).send({ doctorId, startsAt, endsAt });
    expect(booking.status).toBe(201);
    const patientList = await request(app).get("/api/v1/appointments/me").set("Cookie", `session=${patientToken}`);
    const doctorList = await request(app).get("/api/v1/appointments/doctor/me").set("Cookie", `session=${doctorToken}`);
    expect(patientList.body.data.appointments).toHaveLength(1); expect(doctorList.body.data.appointments).toHaveLength(1);
    expect(repository.notifications.filter(({ key }) => key === `${repository.appointments[0]?.id}:created`)).toHaveLength(2);
  });

  it("allows only one concurrent overlapping booking", async () => {
    const patient1 = await repository.createSession("patient1"); const patient2 = await repository.createSession("patient2");
    const payload = { doctorId, startsAt, endsAt };
    const results = await Promise.all([
      request(app).post("/api/v1/appointments").set("Cookie", `session=${patient1}`).send(payload),
      request(app).post("/api/v1/appointments").set("Cookie", `session=${patient2}`).send(payload)
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
  });

  it("rejects booking with an unapproved doctor at the persistence boundary", async () => {
    repository.doctorApproval.set(doctorId, "pending");
    const patientToken = await repository.createSession("patient1");
    const result = await request(app).post("/api/v1/appointments").set("Cookie", `session=${patientToken}`).send({ doctorId, startsAt, endsAt });
    expect(result.status).toBe(409);
    expect(result.body.error.code).toBe("DOCTOR_NOT_APPROVED");
    expect(repository.appointments).toHaveLength(0);
  });

  it("enforces unauthenticated and resource-level access", async () => {
    const unauthorized = await request(app).post("/api/v1/appointments").send({ doctorId, startsAt, endsAt }); expect(unauthorized.status).toBe(401);
    const patientToken = await repository.createSession("patient1");
    const booked = await request(app).post("/api/v1/appointments").set("Cookie", `session=${patientToken}`).send({ doctorId, startsAt, endsAt });
    const patient2 = await repository.createSession("patient2");
    const hidden = await request(app).post(`/api/v1/appointments/${booked.body.data.appointment.id}/cancel`).set("Cookie", `session=${patient2}`).send({});
    expect(hidden.status).toBe(404);
  });

  it("enforces transitions and supports cancellation", async () => {
    const patientToken = await repository.createSession("patient1"); const doctorToken = await repository.createSession("doctor1");
    const booked = await request(app).post("/api/v1/appointments").set("Cookie", `session=${patientToken}`).send({ doctorId, startsAt, endsAt }); const id = booked.body.data.appointment.id;
    const invalid = await request(app).patch(`/api/v1/appointments/${id}/status`).set("Cookie", `session=${doctorToken}`).send({ status: "completed" });
    expect(invalid.status).toBe(409); expect(invalid.body.error.code).toBe("INVALID_STATUS_TRANSITION");
    const cancelled = await request(app).post(`/api/v1/appointments/${id}/cancel`).set("Cookie", `session=${patientToken}`).send({ reason: "Changed plans" });
    expect(cancelled.status).toBe(200); expect(cancelled.body.data.appointment.status).toBe("cancelled");
    const repeat = await request(app).post(`/api/v1/appointments/${id}/cancel`).set("Cookie", `session=${patientToken}`).send({});
    expect(repeat.status).toBe(409);
    expect(repository.notifications.filter(({ key }) => key === `${id}:cancelled`)).toHaveLength(2);
  });

  it("creates unique participant notifications for status changes", async () => {
    const patientToken = await repository.createSession("patient1"); const doctorToken = await repository.createSession("doctor1");
    const booking = await request(app).post("/api/v1/appointments").set("Cookie", `session=${patientToken}`).send({ doctorId, startsAt, endsAt });
    const id = booking.body.data.appointment.id;
    await request(app).patch(`/api/v1/appointments/${id}/status`).set("Cookie", `session=${doctorToken}`).send({ status: "confirmed" });
    expect(repository.notifications.filter(({ key }) => key === `${id}:status_changed`)).toHaveLength(2);
  });
});
