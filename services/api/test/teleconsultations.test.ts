import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { createTeleconsultationRouter } from "../src/teleconsultations/routes.js";
import type { AuthRepository, PublicUser } from "../src/auth/repository.js";
import { errorHandler } from "../src/middleware/error-handler.js";

const patient: PublicUser = { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", email: "patient@example.test", role: "Patient", status: "active" };
const admin: PublicUser = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", email: "admin@example.test", role: "Admin", status: "active" };

function makeApp(user: PublicUser) {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  const auth: AuthRepository = {
    async createPatient() { throw new Error("unused"); },
    async findByEmail() { return undefined; },
    async findById() { return undefined; },
    async createSession() { throw new Error("unused"); },
    async findSession(token) { return token === "session" ? user : undefined; },
    async deleteSession() {}
  };
  const db = { query: vi.fn(), connect: vi.fn() } as unknown as Pool;
  app.use("/api/v1/teleconsultations", createTeleconsultationRouter(auth, db, "healthcare_session"));
  app.use(errorHandler);
  return { app, db };
}

describe("Teleconsultation authorization", () => {
  it("does not allow Admins to enter a consultation or access patient note editing", async () => {
    const { app, db } = makeApp(admin);
    const tokenResponse = await request(app)
      .post("/api/v1/teleconsultations/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/token")
      .set("Cookie", "healthcare_session=session");
    expect(tokenResponse.status).toBe(403);
    expect(tokenResponse.body.error.code).toBe("FORBIDDEN");
    expect(db.query).not.toHaveBeenCalled();
  });

  it("does not let Patients submit doctor-only clinical notes", async () => {
    const { app, db } = makeApp(patient);
    const response = await request(app)
      .put("/api/v1/teleconsultations/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/notes")
      .set("Cookie", "healthcare_session=session")
      .send({ summary: "Synthetic clinical summary" });
    expect(response.status, JSON.stringify(response.body)).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
    expect(db.query).not.toHaveBeenCalled();
  });
});
