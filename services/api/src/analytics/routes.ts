import { Router } from "express";
import type { AuthRepository, PublicUser } from "../auth/repository.js";
import { requireAuthenticated, requireRoles } from "../auth/authorization.js";
import { ApiRequestError } from "../request-error.js";
import type { AnalyticsRepository } from "./types.js";
import { AnalyticsService } from "./service.js";

function currentUser(response: Parameters<import("express").RequestHandler>[1]): PublicUser {
  const user = response.locals.user as PublicUser | undefined;
  if (!user) throw new ApiRequestError(401, "UNAUTHENTICATED", "Authentication is required.");
  return user;
}

export function createAnalyticsRouter(auth: AuthRepository, repository: AnalyticsRepository, cookieName: string): Router {
  const router = Router();
  const service = new AnalyticsService(repository);
  router.get("/overview", requireAuthenticated(auth, cookieName), requireRoles("Admin"), async (_request, response, next) => {
    try {
      currentUser(response);
      const overview = await service.getOverview();
      response.json({ success: true, data: { overview }, meta: { requestId: response.locals.requestId } });
    } catch (error) { next(error); }
  });
  return router;
}
