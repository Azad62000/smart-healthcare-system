import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createAdminAppointmentRouter } from "../src/appointments/admin-routes.js";
import type { AdminAppointment, AdminAppointmentRepository, ScheduleInput } from "../src/appointments/admin-repository.js";
import type { AuthRepository, PublicUser } from "../src/auth/repository.js";
import { errorHandler } from "../src/middleware/error-handler.js";

const admin: PublicUser = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", email: "admin@example.test", role: "Admin", status: "active" };
const patientId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const doctorId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const appointment: AdminAppointment = {
  id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  patientId,
  doctorId,
  startsAt: "2030-05-20T10:00:00.000Z",
  endsAt: "2030-05-20T10:30:00.000Z",
  status: "confirmed",
  patientDisplayName: "Synthetic Patient",
  doctorDisplayName: "Synthetic Doctor",
  specialization: "Family Medicine",
  type: "video",
  schedulingNote: "Follow-up",
  adminNote: "Private admin note",
  patientEmail: "patient@example.test",
  doctorEmail: "doctor@example.test",
  roomName: "consult-synthetic"
};

class MemoryAdminAppointmentRepository implements AdminAppointmentRepository {
  appointments: AdminAppointment[] = [];
  async listOptions() { return { patients: [{ id: patientId, name: "Synthetic Patient", email: "patient@example.test" }], doctors: [{ id: doctorId, name: "Synthetic Doctor", email: "doctor@example.test" }] }; }
  async list() { return this.appointments; }
  async create(input: ScheduleInput) {
    if (this.appointments.some((item) => item.startsAt < input.endsAt && item.endsAt > input.startsAt && item.status === "confirmed")) {
      throw Object.assign(new Error("conflict"), { code: "APPOINTMENT_CONFLICT" });
    }
    const created = { ...appointment, ...input, status: "confirmed" as const };
    this.appointments.push(created);
    return created;
  }
  async reschedule() { return undefined; }
  async cancel() { return undefined; }
}

function makeApp(role: PublicUser["role"], repository: MemoryAdminAppointmentRepository) {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  const auth: AuthRepository = {
    async createPatient() { throw new Error("unused"); },
    async findByEmail() { return undefined; },
    async findById() { return undefined; },
    async createSession() { throw new Error("unused"); },
    async findSession(token) { return token === "session" ? { ...admin, role } : undefined; },
    async deleteSession() {}
  };
  app.use("/api/v1/admin/appointments", createAdminAppointmentRouter(auth, repository, "healthcare_session"));
  app.use(errorHandler);
  return app;
}

describe("Admin appointment scheduling", () => {
  it("requires an Admin session and creates video appointments with validated schedule details", async () => {
    const repository = new MemoryAdminAppointmentRepository();
    const app = makeApp("Admin", repository);
    const denied = await request(app).get("/api/v1/admin/appointments");
    expect(denied.status).toBe(401);

    const scheduled = await request(app)
      .post("/api/v1/admin/appointments")
      .set("Cookie", "healthcare_session=session")
      .send({
        patientId,
        doctorId,
        startsAt: "2030-05-20T10:00:00.000Z",
        endsAt: "2030-05-20T10:30:00.000Z",
        type: "video",
        schedulingNote: "Follow-up",
        adminNote: "Private admin note"
      });
    expect(scheduled.status).toBe(201);
    expect(scheduled.body.data.appointment).toMatchObject({ type: "video", status: "confirmed", patientId, doctorId });
  });

  it("rejects participant overlap and prevents a Patient from using Admin scheduling", async () => {
    const repository = new MemoryAdminAppointmentRepository();
    repository.appointments.push(appointment);
    const app = makeApp("Admin", repository);
    const conflict = await request(app)
      .post("/api/v1/admin/appointments")
      .set("Cookie", "healthcare_session=session")
      .send({
        patientId,
        doctorId,
        startsAt: "2030-05-20T10:15:00.000Z",
        endsAt: "2030-05-20T10:45:00.000Z",
        type: "in_person"
      });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe("APPOINTMENT_CONFLICT");
    const patientResponse = await request(makeApp("Patient", new MemoryAdminAppointmentRepository()))
      .get("/api/v1/admin/appointments")
      .set("Cookie", "healthcare_session=session");
    expect(patientResponse.status).toBe(403);
  });
});
