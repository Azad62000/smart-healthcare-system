import { describe, expect, it } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import type { AuthRepository, PublicUser } from "../src/auth/repository.js";
import { errorHandler } from "../src/middleware/error-handler.js";
import { requestIdMiddleware } from "../src/middleware/request-id.js";
import { createFeedbackRouter } from "../src/feedback/routes.js";
import type { FeedbackRepository, PatientFeedback } from "../src/feedback/types.js";

const appointmentId = "11111111-1111-4111-8111-111111111111";
const patient: PublicUser = { id: "patient-1", email: "patient@example.test", role: "Patient", status: "active" };
const otherPatient: PublicUser = { id: "patient-2", email: "other@example.test", role: "Patient", status: "active" };
const doctor: PublicUser = { id: "doctor-1", email: "doctor@example.test", role: "Doctor", status: "active" };
const otherDoctor: PublicUser = { id: "doctor-2", email: "doctor2@example.test", role: "Doctor", status: "active" };

class MemoryFeedbackRepository implements FeedbackRepository {
  status: string | undefined = "completed";
  owner = patient.id;
  values: PatientFeedback[] = [];
  doctorOwner = doctor.id;
  async listForPatient(patientId: string) { return this.values.filter((item) => this.owner === patientId && item.appointmentId === appointmentId); }
  async listForDoctor(doctorUserId: string) { return doctorUserId === this.doctorOwner ? this.values.map((item) => ({ ...item, appointmentStartsAt: "2030-01-01T10:00:00.000Z" })) : []; }
  async appointmentStatusForPatient(id: string, patientId: string) { return id === appointmentId && patientId === this.owner ? this.status : undefined; }
  async create(patientId: string, id: string, rating: number, comment: string) {
    if (this.values.some((item) => item.appointmentId === id)) return undefined;
    const item = { id: "feedback-1", appointmentId: id, rating, comment, createdAt: new Date().toISOString() };
    this.owner = patientId; this.values.push(item); return item;
  }
}

function setup(repository = new MemoryFeedbackRepository()) {
  const users: Record<string, PublicUser> = { patient: patient, other: otherPatient, doctor, otherDoctor };
  const auth = { findSession: async (token: string) => users[token] } as unknown as AuthRepository;
  const app = express(); app.use(express.json()); app.use(cookieParser()); app.use(requestIdMiddleware);
  app.use("/api/v1/feedback", createFeedbackRouter(auth, repository, "session")); app.use(errorHandler);
  return { app, repository };
}

describe("appointment feedback", () => {
  it("allows only the appointment Patient to leave one bounded rating and comment after completion", async () => {
    const { app, repository } = setup();
    const early = await request(app).post(`/api/v1/feedback/appointments/${appointmentId}`).set("Cookie", "session=patient").send({ rating: 5, comment: "Helpful." });
    expect(early.status).toBe(201);
    const duplicate = await request(app).post(`/api/v1/feedback/appointments/${appointmentId}`).set("Cookie", "session=patient").send({ rating: 4, comment: "Second rating" });
    expect(duplicate.status).toBe(409); expect(duplicate.body.error.code).toBe("FEEDBACK_ALREADY_SUBMITTED");
    expect((await request(app).get("/api/v1/feedback/me").set("Cookie", "session=patient")).body.data.feedback).toHaveLength(1);
    expect((await request(app).get("/api/v1/feedback/me").set("Cookie", "session=other")).body.data.feedback).toHaveLength(0);
    const doctorFeedback = await request(app).get("/api/v1/feedback/doctor/me").set("Cookie", "session=doctor");
    expect(doctorFeedback.status).toBe(200);
    expect(doctorFeedback.body.data.feedback[0]).toMatchObject({ appointmentId, rating: 5, comment: "Helpful." });
    expect(doctorFeedback.body.data.feedback[0]).not.toHaveProperty("patientId");
    const otherDoctorFeedback = await request(app).get("/api/v1/feedback/doctor/me").set("Cookie", "session=otherDoctor");
    expect(otherDoctorFeedback.status).toBe(200);
    expect(otherDoctorFeedback.body.data.feedback).toHaveLength(0);
    expect(repository.values[0]?.comment).toBe("Helpful.");
  });

  it("rejects early, unrelated, unauthorized, and invalid feedback", async () => {
    const { app, repository } = setup();
    repository.status = "confirmed";
    const early = await request(app).post(`/api/v1/feedback/appointments/${appointmentId}`).set("Cookie", "session=patient").send({ rating: 5, comment: "Helpful." });
    expect(early.status).toBe(409); expect(early.body.error.code).toBe("APPOINTMENT_NOT_COMPLETED");
    const unrelated = await request(app).post(`/api/v1/feedback/appointments/${appointmentId}`).set("Cookie", "session=other").send({ rating: 5, comment: "Helpful." });
    expect(unrelated.status).toBe(404);
    const wrongRole = await request(app).get("/api/v1/feedback/me").set("Cookie", "session=doctor");
    expect(wrongRole.status).toBe(403);
    expect((await request(app).get("/api/v1/feedback/doctor/me").set("Cookie", "session=patient")).status).toBe(403);
    const unauthenticated = await request(app).get("/api/v1/feedback/me");
    expect(unauthenticated.status).toBe(401);
    const invalid = await request(app).post(`/api/v1/feedback/appointments/${appointmentId}`).set("Cookie", "session=patient").send({ rating: 6, comment: "" });
    expect(invalid.status).toBe(400);
  });
});
