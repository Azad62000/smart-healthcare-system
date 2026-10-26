import { Router } from "express";
import { z } from "zod";
import type { AuthRepository } from "../auth/repository.js";
import { requireAuthenticated, requireRoles } from "../auth/authorization.js";
import { ApiRequestError } from "../request-error.js";
import type { AppointmentRepository } from "../appointments/types.js";
import type { DoctorRepository } from "../doctors/types.js";
import { DoctorRecommendationService } from "./types.js";

const recommendationQuery = z.object({
  specialization: z.string().trim().min(2).max(100).optional(),
  city: z.string().trim().min(1).max(100).optional(),
  mode: z.enum(["video", "in_person"]).optional(),
  maxFee: z.coerce.number().int().nonnegative().max(1_000_000).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional()
}).strict();

export function createDoctorRecommendationRouter(
  authRepository: AuthRepository,
  doctorRepository: DoctorRepository,
  appointmentRepository: AppointmentRepository,
  cookieName: string,
  enabled: boolean
): Router {
  const router = Router();
  const service = new DoctorRecommendationService(doctorRepository, appointmentRepository);

  router.get("/", requireAuthenticated(authRepository, cookieName), requireRoles("Patient"), async (request, response, next) => {
    try {
      if (!enabled) {
        response.json({ success: true, data: { enabled: false, recommendations: [] }, meta: { requestId: response.locals.requestId } });
        return;
      }
      const parsed = recommendationQuery.safeParse(request.query);
      if (!parsed.success) throw new ApiRequestError(400, "VALIDATION_ERROR", "The request could not be accepted.");
      const now = Date.now();
      const from = parsed.data.from ?? new Date(now).toISOString();
      const to = parsed.data.to ?? new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString();
      const duration = Date.parse(to) - Date.parse(from);
      if (Date.parse(from) < now - 60_000 || duration <= 0 || duration > 90 * 24 * 60 * 60 * 1000) {
        throw new ApiRequestError(400, "VALIDATION_ERROR", "Choose a future availability window up to 90 days long.");
      }
      const recommendations = await service.recommend({ ...parsed.data, from, to });
      response.json({ success: true, data: { enabled: true, recommendations }, meta: { requestId: response.locals.requestId } });
    } catch (error) { next(error); }
  });

  return router;
}
