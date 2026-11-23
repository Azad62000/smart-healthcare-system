import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import type { AuthRepository, PublicUser, UserRecord } from "../src/auth/repository.js";
import { createAiRouter } from "../src/ai/routes.js";
import type { GeminiChatMessage, GeminiChatRepository, GeminiConversation } from "../src/ai/gemini-repository.js";
import { errorHandler } from "../src/middleware/error-handler.js";
import { requestIdMiddleware } from "../src/middleware/request-id.js";
import { ApiRequestError } from "../src/request-error.js";

const patient: PublicUser = { id: "11111111-1111-4111-8111-111111111111", email: "patient@example.test", role: "Patient", status: "active" };
const otherPatient: PublicUser = { id: "22222222-2222-4222-8222-222222222222", email: "other@example.test", role: "Patient", status: "active" };
const doctor: PublicUser = { id: "33333333-3333-4333-8333-333333333333", email: "doctor@example.test", role: "Doctor", status: "active" };
const conversationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

class GeminiTestAuth implements AuthRepository {
  private sessions = new Map([["patient-token", patient], ["other-token", otherPatient], ["doctor-token", doctor]]);
  async createPatient(): Promise<PublicUser> { throw new Error("unused"); }
  async findByEmail(): Promise<UserRecord | undefined> { return undefined; }
  async findById(id: string) { return [patient, otherPatient, doctor].find((user) => user.id === id); }
  async createSession(): Promise<string> { throw new Error("unused"); }
  async findSession(token: string) { return this.sessions.get(token); }
  async deleteSession() {}
}

class MemoryGeminiRepository implements GeminiChatRepository {
  private conversations = new Map<string, { patientId: string; messages: GeminiChatMessage[] }>();
  async listConversations(patientId: string): Promise<GeminiConversation[]> {
    return [...this.conversations.entries()].filter(([, item]) => item.patientId === patientId).map(([id, item]) => ({ id, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", preview: item.messages.at(-1)?.content.slice(0, 160) ?? null }));
  }
  async listMessages(patientId: string, id: string): Promise<GeminiChatMessage[]> {
    const item = this.conversations.get(id);
    if (!item || item.patientId !== patientId) throw new ApiRequestError(404, "GEMINI_CONVERSATION_NOT_FOUND", "Conversation was not found.");
    return item.messages;
  }
  async recentMessages(patientId: string, id: string | undefined, limit: number): Promise<GeminiChatMessage[]> {
    if (!id) return [];
    const item = this.conversations.get(id);
    if (!item || item.patientId !== patientId) throw new ApiRequestError(404, "GEMINI_CONVERSATION_NOT_FOUND", "Conversation was not found.");
    return item.messages.slice(-limit);
  }
  async saveExchange(patientId: string, id: string | undefined, userContent: string, reply: string) {
    const key = id ?? conversationId;
    const item = this.conversations.get(key) ?? { patientId, messages: [] };
    if (item.patientId !== patientId) throw new ApiRequestError(404, "GEMINI_CONVERSATION_NOT_FOUND", "Conversation was not found.");
    const createdAt = new Date().toISOString();
    const messages: GeminiChatMessage[] = [
      { id: `user-${item.messages.length}`, role: "user", content: userContent, createdAt },
      { id: `assistant-${item.messages.length}`, role: "assistant", content: reply, createdAt }
    ];
    item.messages.push(...messages);
    this.conversations.set(key, item);
    return { conversationId: key, messages };
  }
  async deleteConversation(patientId: string, id: string): Promise<void> {
    const item = this.conversations.get(id);
    if (!item || item.patientId !== patientId) throw new ApiRequestError(404, "GEMINI_CONVERSATION_NOT_FOUND", "Conversation was not found.");
    this.conversations.delete(id);
  }
}

function makeApp(repository: GeminiChatRepository) {
  const app = express(); app.use(express.json()); app.use(cookieParser()); app.use(requestIdMiddleware);
  app.use("/api/v1/ai", createAiRouter(new GeminiTestAuth(), "session", repository)); app.use(errorHandler); return app;
}

const body = (message: string, extras: Record<string, unknown> = {}) => ({ message, freeTierAcknowledged: true, ...extras });

describe("Google Gemini patient health chat", () => {
  const originalKey = process.env.GEMINI_API_KEY;
  const originalModel = process.env.GEMINI_MODEL;
  let repository: MemoryGeminiRepository;
  let app: express.Express;
  let fetchMock: MockInstance<typeof fetch>;

  beforeEach(() => {
    process.env.GEMINI_API_KEY = "test-only-google-gemini-key";
    process.env.GEMINI_MODEL = "gemini-3.5-flash-lite";
    repository = new MemoryGeminiRepository();
    app = makeApp(repository);
    fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "I can explain this generally; ask your clinician for interpretation." }] } }] }), { status: 200, headers: { "content-type": "application/json" } }));
  });
  afterEach(() => {
    fetchMock.mockRestore();
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = originalKey;
    if (originalModel === undefined) delete process.env.GEMINI_MODEL; else process.env.GEMINI_MODEL = originalModel;
  });

  it("requires a patient session and blocks doctors from patient health chat", async () => {
    expect((await request(app).get("/api/v1/ai/gemini/conversations")).status).toBe(401);
    expect((await request(app).get("/api/v1/ai/gemini/conversations").set("Cookie", "session=doctor-token")).status).toBe(403);
  });

  it("requires the free-tier data-use acknowledgment before any provider request", async () => {
    const response = await request(app).post("/api/v1/ai/gemini/chat").set("Cookie", "session=patient-token").send({ message: "What does this symptom mean?" });
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("persists patient-owned turns and sends history to the selected Gemini model", async () => {
    const first = await request(app).post("/api/v1/ai/gemini/chat").set("Cookie", "session=patient-token").send(body("I have a headache."));
    expect(first.status).toBe(200);
    const second = await request(app).post("/api/v1/ai/gemini/chat").set("Cookie", "session=patient-token").send(body("It gets worse in the morning.", { conversationId }));
    expect(second.status).toBe(200);
    expect(second.body.data.messages).toHaveLength(2);
    const url = String(fetchMock.mock.calls[1]?.[0]);
    expect(url).toContain("models/gemini-3.5-flash-lite:generateContent");
    const init = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect(new Headers(init.headers).get("x-goog-api-key")).toBe("test-only-google-gemini-key");
    const sent = JSON.parse(String(init.body));
    expect(sent.contents).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "user", parts: [expect.objectContaining({ text: "I have a headache." })] }),
      expect.objectContaining({ role: "model", parts: [expect.objectContaining({ text: expect.stringContaining("clinician") })] }),
      expect.objectContaining({ role: "user", parts: [expect.objectContaining({ text: "It gets worse in the morning." })] })
    ]));
    expect((await request(app).get("/api/v1/ai/gemini/conversations").set("Cookie", "session=other-token")).body.data.conversations).toEqual([]);
    expect((await request(app).get(`/api/v1/ai/gemini/conversations/${conversationId}/messages`).set("Cookie", "session=other-token")).status).toBe(404);
  });

  it("sends pasted report text as data and stores it with the patient conversation", async () => {
    const response = await request(app).post("/api/v1/ai/gemini/chat").set("Cookie", "session=patient-token").send(body("Explain this report", { reportText: "Hemoglobin 10 g/dL" }));
    expect(response.status).toBe(200);
    expect(response.body.data.messages[0].content).toContain("Hemoglobin 10 g/dL");
    const sent = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body));
    expect(sent.contents.at(-1).parts[0].text).toContain("Hemoglobin 10 g/dL");
  });

  it("returns emergency guidance without calling Google and ignores a negated symptom", async () => {
    const emergency = await request(app).post("/api/v1/ai/gemini/chat").set("Cookie", "session=patient-token").send(body("I am having severe chest pain"));
    expect(emergency.status).toBe(200);
    expect(emergency.body.data.reply).toContain("local emergency number");
    expect(fetchMock).not.toHaveBeenCalled();
    const negative = await request(app).post("/api/v1/ai/gemini/chat").set("Cookie", "session=patient-token").send(body("I do not have chest pain, just a mild cough."));
    expect(negative.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("maps Google free-tier quota responses to a clear rate-limit error", async () => {
    fetchMock.mockImplementation(async () => new Response("{}", { status: 429 }));
    const response = await request(app).post("/api/v1/ai/gemini/chat").set("Cookie", "session=patient-token").send(body("Can you explain this cough?"));
    expect(response.status).toBe(429);
    expect(response.body.error.code).toBe("GEMINI_QUOTA_EXCEEDED");
  });
});
