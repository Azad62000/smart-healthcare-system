import { Router } from "express";
import { z } from "zod";
import type { AuthRepository } from "../auth/repository.js";
import { requireAuthenticated, requireRoles } from "../auth/authorization.js";
import { validateRequest } from "../middleware/validate-request.js";
import { ApiRequestError } from "../request-error.js";

const feature = z.enum([
  "heart-risk", "diabetes-risk", "symptom-checker", "general-health-risk",
  "medical-image", "medication-interactions", "health-trends"
]);
const predictSchema = z.object({
  feature,
  input: z.record(z.string(), z.union([z.string().max(1000), z.number().finite(), z.boolean(), z.null()]))
}).strict();

export function createAiRouter(auth: AuthRepository, cookieName: string): Router {
  const router = Router();
  router.use(requireAuthenticated(auth, cookieName), requireRoles("Patient", "Doctor"));
  router.get("/status", (_request, response) => {
    response.json({
      success: true,
      data: { configured: false, service: null, message: "No AI inference service is configured." },
      meta: { requestId: response.locals.requestId }
    });
  });
  router.post("/predictions", validateRequest({ body: predictSchema }), (_request, response, next) => {
    next(new ApiRequestError(503, "AI_SERVICE_NOT_CONFIGURED", "No AI inference service is configured. No health data was sent to an external service."));
  });
  return router;
}
