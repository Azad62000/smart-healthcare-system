import type { RequestHandler } from "express";
import { log } from "../logger.js";

export const requestLogger: RequestHandler = (request, response, next) => {
  const startedAt = Date.now();
  response.on("finish", () => {
    // Use the Express route template, not the concrete URL, so record/user IDs are not copied to logs.
    const routePath = request.route?.path;
    const routeTemplate = routePath ? `${request.baseUrl}${Array.isArray(routePath) ? routePath[0] : routePath}` : "unmatched";
    log("info", "http.request.completed", {
      requestId: response.locals.requestId,
      method: request.method,
      path: routeTemplate,
      statusCode: response.statusCode,
      durationMs: Date.now() - startedAt
    });
  });
  next();
};
