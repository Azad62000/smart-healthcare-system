import { Router } from "express";
import { z } from "zod";
import type { AuthRepository, PublicUser } from "../auth/repository.js";
import { requireAuthenticated, requireRoles } from "../auth/authorization.js";
import { validateRequest } from "../middleware/validate-request.js";
import { ApiRequestError } from "../request-error.js";
import { ChatRateLimiter } from "./rate-limiter.js";
import type { ChatRepository } from "./types.js";
import type { ChatRealtime } from "./realtime.js";

const conversationParams = validateRequest({
  params: z.object({ conversationId: z.string().uuid() }),
  query: z.object({ appointmentId: z.string().uuid().optional() })
});
const historyQuery = validateRequest({
  params: z.object({ conversationId: z.string().uuid() }),
  query: z.object({
    before: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    appointmentId: z.string().uuid().optional()
  })
});
const messageBody = z.object({
  clientMessageId: z.string().uuid(),
  message: z.string().trim().min(1).max(4000)
}).strict();
const sendMessageRequest = validateRequest({
  params: z.object({ conversationId: z.string().uuid() }),
  query: z.object({ appointmentId: z.string().uuid().optional() }),
  body: messageBody
});

function currentUser(response: Parameters<import("express").RequestHandler>[1]): PublicUser {
  const user = response.locals.user;
  if (!user) throw new ApiRequestError(401, "UNAUTHENTICATED", "Authentication is required.");
  return user;
}

function requireMessagingRole(user: PublicUser) {
  if (user.role !== "Patient" && user.role !== "Doctor") {
    throw new ApiRequestError(403, "FORBIDDEN", "Administrators cannot access patient conversations.");
  }
}

export function createChatRouter(
  auth: AuthRepository,
  repository: ChatRepository,
  cookieName: string,
  realtime: ChatRealtime,
  limiter: ChatRateLimiter
): Router {
  const router = Router();
  router.use(requireAuthenticated(auth, cookieName));

  router.get("/status", requireRoles("Patient"), (_request, response) => {
    response.json({
      success: true,
      data: { configured: false, message: "The optional chatbot is unavailable. Patient–Doctor messaging is available in your care workspace." },
      meta: { requestId: response.locals.requestId }
    });
  });
  router.post("/messages", requireRoles("Patient"), validateRequest({
    body: z.object({ message: z.string().trim().min(1).max(4000) }).strict()
  }), (_request, _response, next) => {
    next(new ApiRequestError(503, "CHATBOT_NOT_CONFIGURED", "The optional chatbot is not configured. Use Patient–Doctor messaging from your care workspace."));
  });

  router.get("/conversations", async (_request, response, next) => {
    try {
      const user = currentUser(response);
      requireMessagingRole(user);
      const conversations = await repository.listConversations(user, response.locals.requestId);
      response.json({ success: true, data: { conversations }, meta: { requestId: response.locals.requestId } });
    } catch (error) { next(error); }
  });

  router.get("/appointments/:appointmentId/conversation", validateRequest({ params: z.object({ appointmentId: z.string().uuid() }) }), async (_request, response, next) => {
    try {
      const user = currentUser(response); requireMessagingRole(user);
      const { appointmentId } = response.locals.validated.params as { appointmentId: string };
      const conversation = await repository.getAppointmentConversation(user, appointmentId, response.locals.requestId);
      response.json({ success: true, data: { conversation }, meta: { requestId: response.locals.requestId } });
    } catch (error) { next(error); }
  });

  router.get("/conversations/:conversationId/messages", historyQuery, async (_request, response, next) => {
    try {
      const user = currentUser(response);
      requireMessagingRole(user);
      const { conversationId } = response.locals.validated.params as { conversationId: string };
      const { before, limit, appointmentId } = response.locals.validated.query as { before?: number; limit: number; appointmentId?: string };
      const page = await repository.listMessages(user, conversationId, before, limit, response.locals.requestId, appointmentId);
      response.json({ success: true, data: page, meta: { requestId: response.locals.requestId } });
    } catch (error) { next(error); }
  });

  router.post("/conversations/:conversationId/messages", sendMessageRequest, async (_request, response, next) => {
    try {
      const user = currentUser(response);
      requireMessagingRole(user);
      if (!limiter.consume(user.id)) throw new ApiRequestError(429, "MESSAGE_RATE_LIMITED", "You are sending messages too quickly. Please wait and try again.");
      const { conversationId } = response.locals.validated.params as { conversationId: string };
      const { appointmentId } = response.locals.validated.query as { appointmentId?: string };
      const input = response.locals.validated.body as z.infer<typeof messageBody>;
      const result = await repository.sendMessage(user, {
        conversationId,
        clientMessageId: input.clientMessageId,
        body: input.message,
        appointmentId
      }, response.locals.requestId);
      realtime.publishMessage(result.message);
      response.status(result.duplicate ? 200 : 201).json({
        success: true,
        data: result,
        meta: { requestId: response.locals.requestId }
      });
    } catch (error) { next(error); }
  });

  router.post("/conversations/:conversationId/read", conversationParams, async (_request, response, next) => {
    try {
      const user = currentUser(response);
      requireMessagingRole(user);
      const { conversationId } = response.locals.validated.params as { conversationId: string };
      const { appointmentId } = response.locals.validated.query as { appointmentId?: string };
      const lastReadSequence = await repository.markRead(user, conversationId, response.locals.requestId, appointmentId);
      realtime.publishRead(conversationId, user.id, lastReadSequence);
      response.json({ success: true, data: { lastReadSequence }, meta: { requestId: response.locals.requestId } });
    } catch (error) { next(error); }
  });

  return router;
}
