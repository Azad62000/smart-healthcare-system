import { beforeEach, describe, expect, it } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import type { AuthRepository, PublicUser, UserRecord, UserRole } from "../src/auth/repository.js";
import { createDoctorRecommendationRouter } from "../src/recommendations/routes.js";
import type { Appointment, AppointmentRepository, AvailableSlot } from "../src/appointments/types.js";
import type { DoctorProfile, DoctorProfileInput, DoctorRepository, DoctorApprovalStatus, DoctorAvailability } from "../src/doctors/types.js";
import { errorHandler } from "../src/middleware/error-handler.js";
import { requestIdMiddleware } from "../src/middleware/request-id.js";

const matchedId = "11111111-1111-4111-8111-111111111111";
const earlierId = "22222222-2222-4222-8222-222222222222";
const unavailableId = "33333333-3333-4333-8333-333333333333";

class RecommendationFixtures implements AuthRepository, DoctorRepository, AppointmentRepository {
  readonly users = new Map<string, PublicUser>();
  readonly sessions = new Map<string, string>();
  readonly profiles: DoctorProfile[] = [];
  readonly slots = new Map<string, AvailableSlot[]>();
  listSlotCalls = 0;

  async addUser(id: string, role: UserRole) { const user = { id, email: `${id}@example.test`, role, status: "active" as const }; this.users.set(id, user); return user; }
  async createPatient(email: string) { return this.addUser(email, "Patient"); }
  async findByEmail(email: string): Promise<UserRecord | undefined> { const user = [...this.users.values()].find((candidate) => candidate.email === email); return user && { ...user, password_hash: "unused" }; }
  async findById(_id: string): Promise<never> { throw new Error("findById is not used in recommendation tests"); }
  async createSession(userId: string) { const token = `session-${userId}`; this.sessions.set(token, userId); return token; }
  async findSession(token: string) { const user = this.users.get(this.sessions.get(token) ?? ""); return user?.status === "active" ? user : undefined; }
  async deleteSession(token: string) { this.sessions.delete(token); }
  async listApproved(specialization?: string) { return this.profiles.filter((profile) => profile.approvalStatus === "approved" && (!specialization || profile.specialization.toLowerCase() === specialization.toLowerCase())); }
  async listPending() { return this.profiles.filter((profile) => profile.approvalStatus === "pending"); }
  async findPublicById(id: string) { return this.profiles.find((profile) => profile.id === id && profile.approvalStatus === "approved"); }
  async findByUserId(userId: string) { return this.profiles.find((profile) => profile.userId === userId); }
  async saveProfile(_userId: string, _profile: DoctorProfileInput): Promise<DoctorProfile> { throw new Error("not used in recommendation tests"); }
  async setApprovalStatus(_id: string, _status: DoctorApprovalStatus) { return undefined; }
  async replaceAvailability(_userId: string, _slots: Array<{ startsAt: string; endsAt: string }>): Promise<DoctorAvailability[]> { return []; }
  async listAvailableSlots(doctorId: string, _from: string, _to: string) { this.listSlotCalls += 1; return this.slots.get(doctorId) ?? []; }
  async create(_patientId: string, _doctorId: string, _startsAt: string, _endsAt: string, _actorId: string): Promise<Appointment> { throw new Error("not used in recommendation tests"); }
  async listForPatient(_patientId: string, _from?: string, _to?: string) { return []; }
  async listForDoctor(_doctorId: string, _from?: string, _to?: string) { return []; }
  async findDoctorIdByUserId(_userId: string) { return undefined; }
  async findForActor(_id: string, _actorId: string, _role: "Patient" | "Doctor" | "Admin") { return undefined; }
  async hasCareRelationship(_doctorId: string, _patientId: string) { return false; }
  async cancel(_id: string, _actorId: string, _role: "Patient" | "Doctor", _reason?: string) { return undefined; }
  async transition(_id: string, _actorId: string, _status: "booked" | "confirmed" | "cancelled" | "completed" | "no_show") { return undefined; }

  addProfile(id: string, specialization: string, approvalStatus: DoctorProfile["approvalStatus"] = "approved") {
    const now = new Date().toISOString();
    this.profiles.push({ id, userId: `user-${id}`, givenName: "Taylor", familyName: id === matchedId ? "Match" : "Doctor", specialization, qualification: "MD", experienceYears: 5, bio: null, approvalStatus, availability: [], createdAt: now, updatedAt: now });
  }
}

function makeApp(repository: RecommendationFixtures, enabled: boolean) {
  const app = express(); app.use(express.json()); app.use(cookieParser()); app.use(requestIdMiddleware);
  app.use("/api/v1/doctors/recommendations", createDoctorRecommendationRouter(repository, repository, repository, "session", enabled));
  app.use(errorHandler); return app;
}

describe("Doctor Recommendation Service", () => {
  let repository: RecommendationFixtures;
  let startsAt: string;
  let app: express.Express;

  beforeEach(async () => {
    repository = new RecommendationFixtures();
    await repository.addUser("patient", "Patient");
    await repository.addUser("doctor-user", "Doctor");
    repository.addProfile(matchedId, "Cardiology");
    repository.addProfile(earlierId, "Neurology");
    repository.addProfile(unavailableId, "Cardiology", "pending");
    startsAt = new Date(Date.now() + 4 * 60 * 60_000).toISOString();
    const earlier = new Date(Date.now() + 2 * 60 * 60_000).toISOString();
    repository.slots.set(matchedId, [{ startsAt, endsAt: new Date(Date.parse(startsAt) + 30 * 60_000).toISOString() }]);
    repository.slots.set(earlierId, [{ startsAt: earlier, endsAt: new Date(Date.parse(earlier) + 30 * 60_000).toISOString() }]);
  });

  it("returns disabled state without touching recommendation data when the feature flag is off", async () => {
    app = makeApp(repository, false);
    const token = await repository.createSession("patient");
    const response = await request(app).get("/api/v1/doctors/recommendations").set("Cookie", `session=${token}`);
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ enabled: false, recommendations: [] });
    expect(repository.listSlotCalls).toBe(0);
  });

  it("requires a Patient session and rejects unauthenticated or other-role users", async () => {
    app = makeApp(repository, true);
    expect((await request(app).get("/api/v1/doctors/recommendations")).status).toBe(401);
    const doctorToken = await repository.createSession("doctor-user");
    expect((await request(app).get("/api/v1/doctors/recommendations").set("Cookie", `session=${doctorToken}`)).status).toBe(403);
  });

  it("prioritizes exact specialization matches, then earliest free slot, and returns transparent reasons", async () => {
    app = makeApp(repository, true);
    const token = await repository.createSession("patient");
    const response = await request(app).get("/api/v1/doctors/recommendations?specialization=cardiology").set("Cookie", `session=${token}`);
    expect(response.status).toBe(200);
    expect(response.body.data.recommendations.map((item: { doctor: { id: string } }) => item.doctor.id)).toEqual([matchedId, earlierId]);
    expect(response.body.data.recommendations[0].reasons).toEqual([
      "Matches requested specialization: Cardiology",
      `Earliest available slot: ${startsAt}`
    ]);
    expect(JSON.stringify(response.body)).not.toMatch(/clinical suitability|best treatment/i);
    expect(response.body.data.recommendations[0].doctor).not.toHaveProperty("userId");
    expect(response.body.data.recommendations.some((item: { doctor: { id: string } }) => item.doctor.id === unavailableId)).toBe(false);
  });

  it("validates time windows", async () => {
    app = makeApp(repository, true);
    const token = await repository.createSession("patient");
    const from = new Date(Date.now() + 3 * 86400_000).toISOString();
    const to = new Date(Date.now() + 2 * 86400_000).toISOString();
    const response = await request(app).get(`/api/v1/doctors/recommendations?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`).set("Cookie", `session=${token}`);
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("applies city, supported-mode, and budget filters and labels synthetic profiles", async () => {
    const target = repository.profiles.find((profile) => profile.id === matchedId)!;
    Object.assign(target, {
      isSynthetic: true,
      city: "Pune",
      state: "Maharashtra",
      consultationModes: ["video", "in_person"],
      consultationFeeInr: 500,
      acceptingAppointments: true
    });
    const other = repository.profiles.find((profile) => profile.id === earlierId)!;
    Object.assign(other, {
      city: "Mumbai",
      consultationModes: ["video"],
      consultationFeeInr: 1500,
      acceptingAppointments: true
    });
    app = makeApp(repository, true);
    const token = await repository.createSession("patient");
    const response = await request(app)
      .get("/api/v1/doctors/recommendations?city=Pune&mode=in_person&maxFee=600")
      .set("Cookie", `session=${token}`);
    expect(response.status).toBe(200);
    expect(response.body.data.recommendations).toHaveLength(1);
    expect(response.body.data.recommendations[0].doctor).toMatchObject({
      id: matchedId, city: "Pune", consultationModes: ["video", "in_person"],
      consultationFeeInr: 500, isSynthetic: true
    });
    expect(response.body.data.recommendations[0].reasons).toContain("Synthetic demo profile; not a verified healthcare provider");
  });

  it("returns no recommendations for an unmatched filter and rejects unsupported modes", async () => {
    app = makeApp(repository, true);
    const token = await repository.createSession("patient");
    const empty = await request(app)
      .get("/api/v1/doctors/recommendations?city=Nowhere")
      .set("Cookie", `session=${token}`);
    expect(empty.status).toBe(200);
    expect(empty.body.data.recommendations).toEqual([]);

    const invalid = await request(app)
      .get("/api/v1/doctors/recommendations?mode=telephone")
      .set("Cookie", `session=${token}`);
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe("VALIDATION_ERROR");
  });
});
