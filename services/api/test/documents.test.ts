import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import cookieParser from "cookie-parser";
import express from "express";
import request from "supertest";
import type { AuthRepository, PublicUser, UserRecord, UserRole } from "../src/auth/repository.js";
import type { Appointment, AppointmentRepository } from "../src/appointments/types.js";
import { errorHandler } from "../src/middleware/error-handler.js";
import { requestIdMiddleware } from "../src/middleware/request-id.js";
import { createAppointmentDocumentRouter } from "../src/documents/routes.js";
import { PrivateDocumentStorage } from "../src/documents/storage.js";
import { MedicalDataCrypto } from "../src/medical-data-crypto.js";
import type {
  AppointmentDocument,
  AppointmentDocumentRepository,
  DocumentMediaType,
  NewAppointmentDocument
} from "../src/documents/types.js";

const appointmentId = "11111111-1111-4111-8111-111111111111";
const doctorId = "22222222-2222-4222-8222-222222222222";
const documentId = "33333333-3333-4333-8333-333333333333";
const appointment: Appointment = {
  id: appointmentId, patientId: "patient", doctorId, startsAt: new Date(Date.now() + 86400_000).toISOString(),
  endsAt: new Date(Date.now() + 90000_000).toISOString(), status: "confirmed",
  patientDisplayName: "Synthetic Patient", doctorDisplayName: "Synthetic Doctor", specialization: "Cardiology"
};

class TestAuthRepository implements AuthRepository {
  sessions = new Map<string, PublicUser>();
  async createPatient(email: string) { return { id: email, email, role: "Patient" as const, status: "active" as const }; }
  async findByEmail(_email: string): Promise<UserRecord | undefined> { return undefined; }
  async findById(id: string) { return [...this.sessions.values()].find((user) => user.id === id); }
  async createSession(userId: string) { return userId; }
  async findSession(token: string) { return this.sessions.get(token); }
  async deleteSession(token: string) { this.sessions.delete(token); }
}

class TestAppointmentRepository implements AppointmentRepository {
  async listAvailableSlots() { return []; }
  async create() { return appointment; }
  async listForPatient() { return []; }
  async listForDoctor() { return []; }
  async findDoctorIdByUserId() { return doctorId; }
  async findForActor(id: string, actorId: string, role: UserRole) {
    if (id !== appointmentId) return undefined;
    if ((role === "Patient" && actorId === appointment.patientId) ||
        (role === "Doctor" && actorId === "doctor-user")) return appointment;
    return undefined;
  }
  async findById() { return appointment; }
  async hasCareRelationship() { return true; }
  async cancel() { return undefined; }
  async transition() { return undefined; }
}

class TestDocumentRepository implements AppointmentDocumentRepository {
  stored: AppointmentDocument & { storageKey: string; mediaType: DocumentMediaType; storageFormat: "aes-256-gcm-v1" | "legacy-plaintext" } | undefined;
  createCalls = 0;
  failCreate = false;
  async list() { return this.stored ? [this.publicDocument(this.stored)] : []; }
  async create(input: NewAppointmentDocument) {
    this.createCalls += 1;
    if (this.failCreate) throw new Error("synthetic repository failure");
    this.stored = {
      id: documentId, appointmentId: input.appointmentId, filename: input.filename,
      mediaType: input.mediaType, byteSize: input.byteSize, uploaderName: "Synthetic Patient",
      uploadedAt: new Date().toISOString(), canDelete: true, storageKey: input.storageKey,
      storageFormat: input.storageFormat
    };
    return this.publicDocument(this.stored);
  }
  async findForDownload(_appointmentId: string, id: string) {
    return id === this.stored?.id ? this.stored : undefined;
  }
  async delete(_appointmentId: string, id: string) {
    if (id !== this.stored?.id) return undefined;
    const result = { storageKey: this.stored.storageKey, mediaType: this.stored.mediaType };
    this.stored = undefined;
    return result;
  }
  private publicDocument(document: AppointmentDocument) {
    const { id, appointmentId: linkedAppointment, filename, mediaType, byteSize, uploaderName, uploadedAt, canDelete } = document;
    return { id, appointmentId: linkedAppointment, filename, mediaType, byteSize, uploaderName, uploadedAt, canDelete };
  }
}

describe("private appointment documents", () => {
  let authRepository: TestAuthRepository;
  let appointmentRepository: TestAppointmentRepository;
  let documentRepository: TestDocumentRepository;
  let app: express.Express;
  let storage: PrivateDocumentStorage;
  let directory: string;

  beforeEach(async () => {
    authRepository = new TestAuthRepository();
    appointmentRepository = new TestAppointmentRepository();
    documentRepository = new TestDocumentRepository();
    authRepository.sessions.set("patient-session", { id: "patient", email: "p@example.test", role: "Patient", status: "active" });
    authRepository.sessions.set("doctor-session", { id: "doctor-user", email: "d@example.test", role: "Doctor", status: "active" });
    authRepository.sessions.set("admin-session", { id: "admin", email: "a@example.test", role: "Admin", status: "active" });
    authRepository.sessions.set("other-session", { id: "other", email: "other@example.test", role: "Patient", status: "active" });
    directory = await mkdtemp(join(tmpdir(), "private-documents-"));
    storage = new PrivateDocumentStorage(
      directory,
      1_048_576,
      MedicalDataCrypto.fromConfiguration(`test:${"a".repeat(64)}`)
    );
    app = express();
    app.use(cookieParser());
    app.use(requestIdMiddleware);
    app.use("/api/v1", createAppointmentDocumentRouter(authRepository, appointmentRepository, documentRepository, storage, "session"));
    app.use(errorHandler);
  });

  afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

  it("allows appointment participants to upload and retrieve private supported documents", async () => {
    const pdf = Buffer.from("%PDF-1.7\nsynthetic fixture");
    const uploaded = await request(app).post(`/api/v1/appointments/${appointmentId}/documents`)
      .set("Cookie", "session=patient-session")
      .set("Content-Type", "application/pdf")
      .set("x-file-name", encodeURIComponent("visit report.pdf"))
      .send(pdf);
    expect(uploaded.status).toBe(201);
    expect(uploaded.body.data.document.filename).toBe("visit report.pdf");
    expect(uploaded.body.data.document).not.toHaveProperty("storageFormat");
    expect(uploaded.body.data.document).not.toHaveProperty("storageKey");
    const storedFile = await readFile(join(directory, `${documentRepository.stored!.storageKey}.enc`));
    expect(storedFile.toString()).toMatch(/^shc1\.test\./);
    expect(storedFile.toString()).not.toContain("%PDF-1.7");
    const listing = await request(app).get(`/api/v1/appointments/${appointmentId}/documents`).set("Cookie", "session=doctor-session");
    expect(listing.body.data.documents[0]).toMatchObject({ filename: "visit report.pdf", uploaderName: "Synthetic Patient" });
    const downloaded = await request(app).get(`/api/v1/appointments/${appointmentId}/documents/${documentId}`)
      .set("Cookie", "session=doctor-session")
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        response.on("end", () => callback(null, Buffer.concat(chunks)));
      });
    expect(downloaded.status).toBe(200);
    expect(downloaded.headers["cache-control"]).toBe("private, no-store");
    expect(downloaded.body.toString()).toContain("%PDF-1.7");
  });

  it("does not return plaintext when encrypted storage authentication fails", async () => {
    const uploaded = await request(app).post(`/api/v1/appointments/${appointmentId}/documents`)
      .set("Cookie", "session=patient-session")
      .set("Content-Type", "application/pdf")
      .set("x-file-name", "tampered.pdf")
      .send(Buffer.from("%PDF-1.7\nsynthetic fixture"));
    expect(uploaded.status).toBe(201);
    const path = join(directory, `${documentRepository.stored!.storageKey}.enc`);
    const encrypted = await readFile(path);
    const envelope = encrypted.toString().split(".");
    envelope[4] = `${envelope[4]![0] === "A" ? "B" : "A"}${envelope[4]!.slice(1)}`;
    await writeFile(path, envelope.join("."));

    const unauthorized = await request(app)
      .get(`/api/v1/appointments/${appointmentId}/documents/${documentId}`)
      .set("Cookie", "session=other-session");
    expect(unauthorized.status).toBe(404);
    const response = await request(app)
      .get(`/api/v1/appointments/${appointmentId}/documents/${documentId}`)
      .set("Cookie", "session=doctor-session");
    expect(response.status).toBe(500);
    expect(JSON.stringify(response.body)).not.toContain("synthetic fixture");
  });

  it("removes encrypted files when metadata creation fails", async () => {
    documentRepository.failCreate = true;
    const response = await request(app).post(`/api/v1/appointments/${appointmentId}/documents`)
      .set("Cookie", "session=patient-session")
      .set("Content-Type", "application/pdf")
      .set("x-file-name", "orphan.pdf")
      .send(Buffer.from("%PDF-1.7\nsynthetic fixture"));
    expect(response.status).toBe(500);
    expect(documentRepository.stored).toBeUndefined();
    expect(await readdir(directory)).toEqual([]);
  });

  it("continues to read explicitly marked legacy plaintext files during migration", async () => {
    const storageKey = "44444444-4444-4444-8444-444444444444";
    const legacy = Buffer.from("%PDF-1.7\nlegacy fixture");
    await writeFile(join(directory, `${storageKey}.pdf`), legacy, { mode: 0o600 });
    const stream = await storage.open(storageKey, "application/pdf", "legacy-plaintext");
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks)).toEqual(legacy);
  });

  it("denies unrelated users and administrators and rejects mismatched file content", async () => {
    for (const session of ["admin-session"]) {
      const denied = await request(app).get(`/api/v1/appointments/${appointmentId}/documents`).set("Cookie", `session=${session}`);
      expect(denied.status).toBe(403);
    }
    const unrelated = await request(app).post(`/api/v1/appointments/${appointmentId}/documents`)
      .set("Cookie", "session=doctor-session")
      .set("Content-Type", "application/pdf")
      .set("x-file-name", "fake.pdf")
      .send(Buffer.from("<html>not a pdf</html>"));
    expect(unrelated.status).toBe(415);
    expect(documentRepository.createCalls).toBe(0);
  });

  it("does not accept documents for appointments the caller does not participate in", async () => {
    const unrelated = await request(app).get(`/api/v1/appointments/${appointmentId}/documents`).set("Cookie", "session=other-session");
    expect(unrelated.status).toBe(404);
    const denied = await request(app).post(`/api/v1/appointments/${appointmentId}/documents`)
      .set("Cookie", "session=admin-session")
      .set("Content-Type", "application/pdf")
      .set("x-file-name", "report.pdf")
      .send(Buffer.from("%PDF-1.7\nsynthetic fixture"));
    expect(denied.status).toBe(403);
    expect(documentRepository.createCalls).toBe(0);
  });

  it("enforces configured streaming upload limits", async () => {
    const oversizedFile = Buffer.alloc(1_048_577);
    Buffer.from("%PDF-1.7\n").copy(oversizedFile);
    const oversized = await request(app).post(`/api/v1/appointments/${appointmentId}/documents`)
      .set("Cookie", "session=patient-session")
      .set("Content-Type", "application/pdf")
      .set("x-file-name", "large.pdf")
      .send(oversizedFile);
    expect(oversized.status).toBe(413);
    expect(documentRepository.createCalls).toBe(0);
  });
});
