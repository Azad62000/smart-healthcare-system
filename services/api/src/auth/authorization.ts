import type { RequestHandler } from "express";
import type { PublicUser, UserRole } from "./repository.js";
import { ApiRequestError } from "../request-error.js";

declare global {
  namespace Express {
    interface Locals { user?: PublicUser; }
  }
}

export function requireAuthenticated(repository: { findSession(token: string): Promise<PublicUser | undefined> }, cookieName: string): RequestHandler {
  return async (request, response, next) => {
    const token = request.cookies?.[cookieName];
    if (typeof token !== "string") return next(new ApiRequestError(401, "UNAUTHENTICATED", "Authentication is required."));
    try {
      const user = await repository.findSession(token);
      if (!user) return next(new ApiRequestError(401, "UNAUTHENTICATED", "Authentication is required."));
      response.locals.user = user;
      next();
    } catch (error) { next(error); }
  };
}

export function requireRoles(...allowedRoles: UserRole[]): RequestHandler {
  return (_request, response, next) => {
    const user = response.locals.user;
    if (!user) return next(new ApiRequestError(401, "UNAUTHENTICATED", "Authentication is required."));
    if (!allowedRoles.includes(user.role)) return next(new ApiRequestError(403, "FORBIDDEN", "You are not allowed to perform this action."));
    next();
  };
}

/** Resource-level guard: callers supply a server-derived resource owner ID, never a client role. */
export function requireResourceOwner(getOwnerId: (request: Parameters<RequestHandler>[0], user: PublicUser) => Promise<string | undefined>, allowRoles: UserRole[] = []): RequestHandler {
  return async (request, response, next) => {
    const user = response.locals.user;
    if (!user) return next(new ApiRequestError(401, "UNAUTHENTICATED", "Authentication is required."));
    if (allowRoles.includes(user.role)) return next();
    try {
      const ownerId = await getOwnerId(request, user);
      if (!ownerId || ownerId !== user.id) return next(new ApiRequestError(403, "FORBIDDEN", "You are not allowed to access this resource."));
      next();
    } catch (error) { next(error); }
  };
}
