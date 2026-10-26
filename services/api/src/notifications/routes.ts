import { Router } from "express";
import { z } from "zod";
import type { AuthRepository, PublicUser } from "../auth/repository.js";
import { requireAuthenticated, requireRoles } from "../auth/authorization.js";
import { validateRequest } from "../middleware/validate-request.js";
import { ApiRequestError } from "../request-error.js";
import type { NotificationRepository } from "./types.js";
import { NotificationService } from "./service.js";

function actor(response: Parameters<import("express").RequestHandler>[1]): PublicUser {
  const user = response.locals.user as PublicUser | undefined;
  if (!user) throw new ApiRequestError(401, "UNAUTHENTICATED", "Authentication is required.");
  return user;
}

export function createNotificationRouter(auth: AuthRepository, repository: NotificationRepository, cookieName: string): Router {
  const router = Router();
  const service = new NotificationService(repository);
  router.use(requireAuthenticated(auth, cookieName));
  router.use(requireRoles("Patient", "Doctor", "Admin"));
  router.get("/me", async (_request, response, next) => {
    try {
      const notifications = await service.listMine(actor(response).id);
      response.json({ success: true, data: { notifications, unreadCount: notifications.filter(({ readAt }) => !readAt).length }, meta: { requestId: response.locals.requestId } });
    } catch (error) { next(error); }
  });
  router.patch("/:id/read", validateRequest({ params: z.object({ id: z.string().uuid() }) }), async (_request, response, next) => {
    try {
      const { id } = response.locals.validated.params as { id: string };
      const notification = await service.markRead(id, actor(response).id);
      if (!notification) throw new ApiRequestError(404, "NOTIFICATION_NOT_FOUND", "Notification was not found.");
      response.json({ success: true, data: { notification }, meta: { requestId: response.locals.requestId } });
    } catch (error) { next(error); }
  });
  return router;
}
