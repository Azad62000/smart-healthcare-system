import type { Server as HttpServer } from "node:http";
import { Server, type Socket } from "socket.io";
import type { AuthRepository, PublicUser } from "../auth/repository.js";
import { ApiRequestError } from "../request-error.js";
import { z } from "zod";
import { ChatRateLimiter } from "./rate-limiter.js";
import type { ChatMessage, ChatRepository } from "./types.js";

const sendSchema = z.object({
  conversationId: z.string().uuid(),
  clientMessageId: z.string().uuid(),
  message: z.string().trim().min(1).max(4000)
}).strict();
const conversationSchema = z.object({ conversationId: z.string().uuid() }).strict();
type Ack = (response: { success: true; data: unknown } | { success: false; error: { code: string; message: string } }) => void;

function sessionToken(cookieHeader: string | undefined, cookieName: string): string | undefined {
  const token = cookieHeader?.split(";").map((part) => part.trim())
    .find((part) => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
  if (!token) return undefined;
  try { return decodeURIComponent(token); } catch { return undefined; }
}

function socketUser(socket: Socket): PublicUser | undefined {
  return socket.data.user as PublicUser | undefined;
}

function ackError(ack: Ack | undefined, error: unknown) {
  if (!ack) return;
  if (error instanceof ApiRequestError) {
    ack({ success: false, error: { code: error.code, message: error.message } });
  } else {
    ack({ success: false, error: { code: "INTERNAL_ERROR", message: "Could not complete the messaging request." } });
  }
}

export class ChatRealtime {
  private io: Server | undefined;

  attach(httpServer: HttpServer, auth: AuthRepository, repository: ChatRepository, limiter: ChatRateLimiter, origin: string, cookieName = "healthcare_session"): Server {
    if (this.io) throw new Error("Messaging Socket.IO server is already attached.");
    const io = new Server(httpServer, { cors: { origin, credentials: true } });
    this.io = io;
    io.use(async (socket, next) => {
      const token = sessionToken(socket.handshake.headers.cookie, cookieName);
      if (!token) return next(new Error("Authentication required."));
      try {
        const user = await auth.findSession(token);
        if (!user || (user.role !== "Patient" && user.role !== "Doctor")) return next(new Error("Messaging access is not allowed."));
        socket.data.user = user;
        next();
      } catch {
        next(new Error("Authentication could not be verified."));
      }
    });

    io.on("connection", (socket) => {
      socket.on("conversation:join", async (input: unknown, acknowledge?: Ack) => {
        try {
          const parsed = conversationSchema.safeParse(input);
          if (!parsed.success) throw new ApiRequestError(400, "VALIDATION_ERROR", "Conversation request is invalid.");
          const user = socketUser(socket)!;
          if (!await repository.authorizeConversation(user, parsed.data.conversationId)) {
            throw new ApiRequestError(404, "CONVERSATION_NOT_FOUND", "Conversation was not found.");
          }
          await repository.auditAccess(user, parsed.data.conversationId, "subscribe", socket.id);
          await socket.join(`conversation:${parsed.data.conversationId}`);
          acknowledge?.({ success: true, data: { joined: true } });
        } catch (error) { ackError(acknowledge, error); }
      });

      socket.on("message:send", async (input: unknown, acknowledge?: Ack) => {
        try {
          const parsed = sendSchema.safeParse(input);
          if (!parsed.success) throw new ApiRequestError(400, "VALIDATION_ERROR", "Message request is invalid.");
          const user = socketUser(socket)!;
          if (!limiter.consume(user.id)) throw new ApiRequestError(429, "MESSAGE_RATE_LIMITED", "You are sending messages too quickly. Please wait and try again.");
          const result = await repository.sendMessage(user, {
            conversationId: parsed.data.conversationId,
            clientMessageId: parsed.data.clientMessageId,
            body: parsed.data.message
          }, socket.id);
          io.to(`conversation:${parsed.data.conversationId}`).emit("message:new", result.message);
          acknowledge?.({ success: true, data: result });
        } catch (error) { ackError(acknowledge, error); }
      });

      socket.on("conversation:read", async (input: unknown, acknowledge?: Ack) => {
        try {
          const parsed = conversationSchema.safeParse(input);
          if (!parsed.success) throw new ApiRequestError(400, "VALIDATION_ERROR", "Conversation request is invalid.");
          const user = socketUser(socket)!;
          const lastReadSequence = await repository.markRead(user, parsed.data.conversationId, socket.id);
          io.to(`conversation:${parsed.data.conversationId}`).emit("conversation:read", {
            conversationId: parsed.data.conversationId,
            userId: user.id,
            lastReadSequence
          });
          acknowledge?.({ success: true, data: { lastReadSequence } });
        } catch (error) { ackError(acknowledge, error); }
      });
    });
    return io;
  }

  publishMessage(message: ChatMessage): void {
    this.io?.to(`conversation:${message.conversationId}`).emit("message:new", message);
  }

  publishRead(conversationId: string, userId: string, lastReadSequence: number): void {
    this.io?.to(`conversation:${conversationId}`).emit("conversation:read", { conversationId, userId, lastReadSequence });
  }
}

export const chatRealtime = new ChatRealtime();
