import express from "express";
import { createServer } from "node:http";
import cookieParser from "cookie-parser";
import request from "supertest";
import { io as createClient, type Socket as ClientSocket } from "socket.io-client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AuthRepository, PublicUser, UserRecord } from "../src/auth/repository.js";
import { createChatRouter } from "../src/chat/routes.js";
import { ChatRateLimiter } from "../src/chat/rate-limiter.js";
import { ChatRealtime } from "../src/chat/realtime.js";
import type { ChatConversation, ChatMessage, ChatRepository, MessagePage, SendMessageInput } from "../src/chat/types.js";
import { errorHandler } from "../src/middleware/error-handler.js";
import { requestIdMiddleware } from "../src/middleware/request-id.js";
import { ApiRequestError } from "../src/request-error.js";

const patient: PublicUser = { id: "11111111-1111-4111-8111-111111111111", email: "patient@example.test", role: "Patient", status: "active" };
const doctor: PublicUser = { id: "22222222-2222-4222-8222-222222222222", email: "doctor@example.test", role: "Doctor", status: "active" };
const otherDoctor: PublicUser = { id: "55555555-5555-4555-8555-555555555555", email: "other-doctor@example.test", role: "Doctor", status: "active" };
const stranger: PublicUser = { id: "33333333-3333-4333-8333-333333333333", email: "stranger@example.test", role: "Patient", status: "active" };
const admin: PublicUser = { id: "44444444-4444-4444-8444-444444444444", email: "admin@example.test", role: "Admin", status: "active" };
const conversationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const otherConversationId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

class MemoryChatRepository implements ChatRepository {
  messages: ChatMessage[] = [];
  readSequences = new Map<string, number>();
  relationship = true;
  accessEvents: Array<{ actorId: string; conversationId: string; action: string; requestId: string }> = [];
  private nextSequence = 1;
  private readonly idempotencyKeys = new Map<string, string>();
  private readonly messageBodies = new Map<string, string>();

  async listConversations(user: PublicUser, requestId: string): Promise<ChatConversation[]> {
    if (user.id !== patient.id && user.id !== doctor.id && user.id !== otherDoctor.id) return [];
    this.accessEvents.push({ actorId: user.id, conversationId, action: "list", requestId });
    return [{
      id: conversationId,
      patientId: patient.id,
      doctorId: "doctor-profile-id",
      participantId: user.id === patient.id ? doctor.id : patient.id,
      participantName: user.id === patient.id ? "Dr. Synthetic" : "Synthetic Patient",
      specialization: "Family Medicine",
      lastMessage: this.messages.at(-1) ?? null,
      unreadCount: this.messages.filter((message) => message.senderId !== user.id && message.sequence > (this.readSequences.get(`${conversationId}:${user.id}`) ?? 0)).length,
      updatedAt: this.messages.at(-1)?.createdAt ?? new Date(0).toISOString()
    }];
  }

  async authorizeConversation(user: PublicUser, id: string) {
    return this.relationship && id === conversationId && (user.id === patient.id || user.id === doctor.id);
  }

  async getAppointmentConversation(user: PublicUser, _appointmentId: string, requestId: string): Promise<ChatConversation> {
    if (!await this.authorizeConversation(user, conversationId)) throw new ApiRequestError(404, "APPOINTMENT_NOT_FOUND", "Appointment was not found.");
    this.accessEvents.push({ actorId: user.id, conversationId, action: "history", requestId });
    return (await this.listConversations(user, requestId))[0]!;
  }

  async listMessages(user: PublicUser, id: string, before: number | undefined, limit: number, requestId: string): Promise<MessagePage> {
    if (!await this.authorizeConversation(user, id)) throw new ApiRequestError(404, "CONVERSATION_NOT_FOUND", "Conversation was not found.");
    this.accessEvents.push({ actorId: user.id, conversationId: id, action: "history", requestId });
    const filtered = this.messages.filter((message) => message.conversationId === id && (!before || message.sequence < before));
    const selected = filtered.slice(-limit);
    const hasMore = filtered.length > selected.length;
    return { messages: selected, hasMore, nextCursor: hasMore ? selected[0]?.sequence ?? null : null };
  }

  async sendMessage(user: PublicUser, input: SendMessageInput, requestId: string) {
    if (!await this.authorizeConversation(user, input.conversationId)) throw new ApiRequestError(404, "CONVERSATION_NOT_FOUND", "Conversation was not found.");
    const key = `${input.conversationId}:${user.id}:${input.clientMessageId}`;
    const existingId = this.idempotencyKeys.get(key);
    const existing = this.messages.find((message) => message.id === existingId);
    if (existing) {
      if (this.messageBodies.get(key) !== input.body) throw new ApiRequestError(409, "IDEMPOTENCY_KEY_REUSED", "This message retry key was already used for different content.");
      return { message: existing, duplicate: true };
    }
    const message: ChatMessage & { clientMessageId: string } = {
      id: `message-${this.nextSequence}`,
      sequence: this.nextSequence++,
      conversationId: input.conversationId,
      senderId: user.id,
      senderRole: user.role as "Patient" | "Doctor",
      senderName: user.role === "Doctor" ? "Dr. Synthetic" : "Synthetic Patient",
      body: input.body,
      createdAt: new Date().toISOString(),
      clientMessageId: input.clientMessageId
    };
    this.messages.push(message);
    this.idempotencyKeys.set(key, message.id);
    this.messageBodies.set(key, input.body);
    this.accessEvents.push({ actorId: user.id, conversationId: input.conversationId, action: "send", requestId });
    return { message, duplicate: false };
  }

  async markRead(user: PublicUser, id: string, requestId: string) {
    if (!await this.authorizeConversation(user, id)) throw new ApiRequestError(404, "CONVERSATION_NOT_FOUND", "Conversation was not found.");
    const lastRead = this.messages.at(-1)?.sequence ?? 0;
    this.readSequences.set(`${id}:${user.id}`, lastRead);
    this.accessEvents.push({ actorId: user.id, conversationId: id, action: "read", requestId });
    return lastRead;
  }

  async auditAccess(user: PublicUser, id: string, action: "subscribe", requestId: string) {
    if (!await this.authorizeConversation(user, id)) throw new ApiRequestError(404, "CONVERSATION_NOT_FOUND", "Conversation was not found.");
    this.accessEvents.push({ actorId: user.id, conversationId: id, action, requestId });
  }
}

class MemoryAuth implements AuthRepository {
  private readonly sessions = new Map([["patient-session", patient], ["doctor-session", doctor], ["stranger-session", stranger], ["other-doctor-session", otherDoctor], ["admin-session", admin]]);
  async createPatient(): Promise<PublicUser> { throw new Error("unused"); }
  async findByEmail(): Promise<UserRecord | undefined> { return undefined; }
  async findById(id: string) { return [patient, doctor, stranger, admin].find((user) => user.id === id); }
  async createSession(): Promise<string> { throw new Error("unused"); }
  async findSession(token: string) { return this.sessions.get(token); }
  async deleteSession() {}
}

function makeApp(auth: AuthRepository, repository: ChatRepository, realtime = new ChatRealtime()) {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(requestIdMiddleware);
  app.use("/api/v1/chat", createChatRouter(auth, repository, "healthcare_session", realtime, new ChatRateLimiter()));
  app.use(errorHandler);
  return app;
}

describe("patient-doctor messaging", () => {
  let auth: MemoryAuth;
  let repository: MemoryChatRepository;
  let app: express.Express;

  beforeEach(() => {
    auth = new MemoryAuth();
    repository = new MemoryChatRepository();
    app = makeApp(auth, repository);
  });

  it("requires authentication and only lists authorized Patient or Doctor conversations", async () => {
    expect((await request(app).get("/api/v1/chat/conversations")).status).toBe(401);
    const patientList = await request(app).get("/api/v1/chat/conversations").set("Cookie", "healthcare_session=patient-session");
    expect(patientList.status).toBe(200);
    expect(patientList.body.data.conversations).toHaveLength(1);
    const adminList = await request(app).get("/api/v1/chat/conversations").set("Cookie", "healthcare_session=admin-session");
    expect(adminList.status).toBe(403);
    const strangerHistory = await request(app).get(`/api/v1/chat/conversations/${conversationId}/messages`).set("Cookie", "healthcare_session=stranger-session");
    expect(strangerHistory.status).toBe(404);
    const otherDoctorHistory = await request(app).get(`/api/v1/chat/conversations/${conversationId}/messages`).set("Cookie", "healthcare_session=other-doctor-session");
    expect(otherDoctorHistory.status).toBe(404);
  });

  it("persists messages, deduplicates retried sends, paginates history and tracks read state", async () => {
    const patientCookie = "healthcare_session=patient-session";
    const clientMessageId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const send = () => request(app).post(`/api/v1/chat/conversations/${conversationId}/messages`)
      .set("Cookie", patientCookie).send({ clientMessageId, message: "  Follow-up question  " });
    const first = await send();
    const retry = await send();
    expect(first.status).toBe(201);
    expect(first.body.data.message.body).toBe("Follow-up question");
    expect(retry.status).toBe(200);
    expect(retry.body.data.duplicate).toBe(true);
    expect(repository.messages).toHaveLength(1);
    const mismatchedRetry = await request(app).post(`/api/v1/chat/conversations/${conversationId}/messages`)
      .set("Cookie", patientCookie).send({ clientMessageId, message: "Different body" });
    expect(mismatchedRetry.status).toBe(409);
    expect(mismatchedRetry.body.error.code).toBe("IDEMPOTENCY_KEY_REUSED");
    expect(repository.accessEvents.some((event) => event.action === "send" && event.requestId.length > 0)).toBe(true);
    const secondMessageId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    await request(app).post(`/api/v1/chat/conversations/${conversationId}/messages`)
      .set("Cookie", "healthcare_session=doctor-session")
      .send({ clientMessageId: secondMessageId, message: "Reply" });
    const older = await request(app).get(`/api/v1/chat/conversations/${conversationId}/messages?limit=1`)
      .set("Cookie", patientCookie);
    expect(older.body.data.messages).toHaveLength(1);
    expect(older.body.data.hasMore).toBe(true);
    const next = await request(app).get(`/api/v1/chat/conversations/${conversationId}/messages?limit=1&before=${older.body.data.nextCursor}`)
      .set("Cookie", patientCookie);
    expect(next.body.data.messages).toHaveLength(1);
    const markedRead = await request(app).post(`/api/v1/chat/conversations/${conversationId}/read`).set("Cookie", patientCookie);
    expect(markedRead.body.data.lastReadSequence).toBe(2);
    const unread = await request(app).get("/api/v1/chat/conversations").set("Cookie", "healthcare_session=patient-session");
    expect(unread.body.data.conversations[0].unreadCount).toBe(0);
  });

  it("rejects message content and resource access outside the assigned care relationship", async () => {
    const patientCookie = "healthcare_session=patient-session";
    const invalid = await request(app).post(`/api/v1/chat/conversations/${conversationId}/messages`)
      .set("Cookie", patientCookie)
      .send({ clientMessageId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", message: "  " });
    expect(invalid.status).toBe(400);
    repository.relationship = false;
    const history = await request(app).get(`/api/v1/chat/conversations/${conversationId}/messages`).set("Cookie", patientCookie);
    expect(history.status).toBe(404);
  });

  it("keeps the optional chatbot clearly unavailable without colliding with care messaging", async () => {
    const patientCookie = "healthcare_session=patient-session";
    const status = await request(app).get("/api/v1/chat/status").set("Cookie", patientCookie);
    expect(status.status).toBe(200);
    expect(status.body.data.configured).toBe(false);
    const response = await request(app).post("/api/v1/chat/messages").set("Cookie", patientCookie).send({ message: "Synthetic chatbot test" });
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe("CHATBOT_NOT_CONFIGURED");
  });
});

describe("Socket.IO messaging", () => {
  let httpServer: ReturnType<typeof createServer>;
  let ioServer: ReturnType<ChatRealtime["attach"]>;
  let repository: MemoryChatRepository;
  let clients: ClientSocket[];

  beforeEach(async () => {
    const auth = new MemoryAuth();
    repository = new MemoryChatRepository();
    httpServer = createServer(express());
    ioServer = new ChatRealtime().attach(httpServer, auth, repository, new ChatRateLimiter(), "http://localhost");
    await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
    clients = [];
  });

  afterEach(async () => {
    for (const client of clients) client.disconnect();
    await new Promise<void>((resolve) => ioServer.close(() => resolve()));
  });

  async function connect(token: string): Promise<ClientSocket> {
    const address = httpServer.address();
    if (!address || typeof address === "string") throw new Error("Socket test server did not start.");
    const client = createClient(`http://127.0.0.1:${address.port}`, {
      transports: ["websocket"],
      reconnection: false,
      extraHeaders: { Cookie: `healthcare_session=${token}` }
    });
    clients.push(client);
    await new Promise<void>((resolve, reject) => {
      client.once("connect", resolve);
      client.once("connect_error", reject);
    });
    return client;
  }

  it("authenticates subscriptions, delivers persisted messages and supports reconnect history recovery", async () => {
    const patientClient = await connect("patient-session");
    const doctorClient = await connect("doctor-session");
    const unauthorized = await connect("stranger-session");
    const join = (client: ClientSocket, id: string) => new Promise<{ success: boolean }>((resolve) => {
      client.emit("conversation:join", { conversationId: id }, resolve);
    });
    expect((await join(unauthorized, conversationId)).success).toBe(false);
    await expect(connect("admin-session")).rejects.toThrow();
    expect((await join(patientClient, conversationId)).success).toBe(true);
    expect((await join(doctorClient, conversationId)).success).toBe(true);

    const delivered = new Promise<ChatMessage>((resolve) => doctorClient.once("message:new", resolve));
    const sent = await new Promise<{ success: boolean; data?: { duplicate: boolean } }>((resolve) => {
      patientClient.emit("message:send", {
        conversationId,
        clientMessageId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
        message: "Persist through reconnect"
      }, resolve);
    });
    expect(sent.success).toBe(true);
    expect((await delivered).body).toBe("Persist through reconnect");

    patientClient.disconnect();
    const reconnectedPatient = await connect("patient-session");
    expect((await join(reconnectedPatient, conversationId)).success).toBe(true);
    const recovered = await repository.listMessages(patient, conversationId, undefined, 50, "reconnect");
    expect(recovered.messages.map(({ body }) => body)).toEqual(["Persist through reconnect"]);
  });
});

describe("chat message rate limiting", () => {
  it("limits sends per authenticated user over a fixed interval", () => {
    const limiter = new ChatRateLimiter(2, 1000);
    expect(limiter.consume(patient.id, 100)).toBe(true);
    expect(limiter.consume(patient.id, 101)).toBe(true);
    expect(limiter.consume(patient.id, 102)).toBe(false);
    expect(limiter.consume(doctor.id, 102)).toBe(true);
    expect(limiter.consume(patient.id, 1100)).toBe(true);
  });
});
