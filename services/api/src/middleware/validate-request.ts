import type { RequestHandler } from "express";
import type { ZodType } from "zod";
import { ApiRequestError } from "../request-error.js";

type RequestSchemas = {
  body?: ZodType;
  params?: ZodType;
  query?: ZodType;
};

/** Validate request components before business logic; handlers consume parsed values from res.locals.validated. */
export function validateRequest(schemas: RequestSchemas): RequestHandler {
  return (request, response, next) => {
    const validated: Record<string, unknown> = {};
    for (const key of ["params", "query", "body"] as const) {
      const schema = schemas[key];
      if (!schema) continue;
      const parsed = schema.safeParse(request[key]);
      if (!parsed.success) {
        const details = parsed.error.issues.map((issue) => ({
          field: [key, ...issue.path.map(String)].join("."),
          issue: "Invalid value"
        }));
        return next(new ApiRequestError(400, "VALIDATION_ERROR", "The request could not be accepted.", details));
      }
      validated[key] = parsed.data;
    }
    response.locals.validated = validated;
    next();
  };
}
