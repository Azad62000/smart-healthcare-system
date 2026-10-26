import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";

export const requestIdMiddleware: RequestHandler = (request, response, next) => {
  // Do not accept arbitrary client correlation values into logs. Generate our own opaque ID.
  const requestId = randomUUID();
  response.locals.requestId = requestId;
  response.setHeader("x-request-id", requestId);
  next();
};
