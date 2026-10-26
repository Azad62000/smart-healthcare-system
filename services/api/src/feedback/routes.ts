import { Router } from "express";
import { z } from "zod";
import type { AuthRepository, PublicUser } from "../auth/repository.js";
import { requireAuthenticated, requireRoles } from "../auth/authorization.js";
import { validateRequest } from "../middleware/validate-request.js";
import { ApiRequestError } from "../request-error.js";
import { FeedbackService } from "./service.js";
import type { FeedbackRepository } from "./types.js";

const uuid = z.string().uuid();
const feedbackSchema = z.object({ rating: z.number().int().min(1).max(5), comment: z.string().trim().min(1).max(2000) }).strict();

function currentUser(response: Parameters<import("express").RequestHandler>[1]): PublicUser {
  const user = response.locals.user as PublicUser | undefined;
  if (!user) throw new ApiRequestError(401, "UNAUTHENTICATED", "Authentication is required.");
  return user;
}

export function createFeedbackRouter(authRepository: AuthRepository, repository: FeedbackRepository, cookieName: string): Router {
  const router = Router();
  const service = new FeedbackService(repository);
  router.get("/me", requireAuthenticated(authRepository, cookieName), requireRoles("Patient"), async (_request, response, next) => {
    try {
      const feedback = await service.listForPatient(currentUser(response).id);
      response.json({ success: true, data: { feedback }, meta: { requestId: response.locals.requestId } });
    } catch (error) { next(error); }
  });
  router.get("/doctor/me", requireAuthenticated(authRepository, cookieName), requireRoles("Doctor"), async (_request, response, next) => {
    try {
      const feedback = await service.listForDoctor(currentUser(response).id);
      response.json({ success: true, data: { feedback }, meta: { requestId: response.locals.requestId } });
    } catch (error) { next(error); }
  });
  router.post("/appointments/:appointmentId", requireAuthenticated(authRepository, cookieName), requireRoles("Patient"), validateRequest({
    params: z.object({ appointmentId: uuid }), body: feedbackSchema
  }), async (_request, response, next) => {
    try {
      const { appointmentId } = response.locals.validated.params as { appointmentId: string };
      const { rating, comment } = response.locals.validated.body as z.infer<typeof feedbackSchema>;
      const feedback = await service.submit(currentUser(response).id, appointmentId, rating, comment);
      response.status(201).json({ success: true, data: { feedback }, meta: { requestId: response.locals.requestId } });
    } catch (error) { next(error); }
  });
  return router;
}
