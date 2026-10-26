import type { ErrorRequestHandler } from "express";
import type { ApiResponse } from "@healthcare/shared";
import { ApiRequestError } from "../request-error.js";
import { log } from "../logger.js";
import { ZodError } from "zod";

export const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  const knownError = error instanceof ApiRequestError ? error
    : error instanceof SyntaxError && "body" in error ? new ApiRequestError(400, "INVALID_JSON", "Request body must contain valid JSON.")
    : error instanceof ZodError ? new ApiRequestError(400, "VALIDATION_ERROR", "The request could not be accepted.")
    : undefined;
  const statusCode = knownError?.statusCode ?? 500;
  const payload: ApiResponse<never> = {
    success: false,
    error: {
      code: knownError?.code ?? "INTERNAL_ERROR",
      message: knownError?.message ?? "An unexpected error occurred",
      ...(knownError?.details && { details: knownError.details })
    },
    meta: { requestId: response.locals.requestId ?? "unavailable" }
  };
  if (statusCode >= 500 && process.env.NODE_ENV !== "test") {
    // Log a fixed event only. Never serialize exception, request, or response contents.
    log("error", "http.request.failed", { requestId: response.locals.requestId, statusCode });
  }
  response.status(statusCode).json(payload);
};
