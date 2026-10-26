import { Router } from "express";
import { z } from "zod";
import type { PublicUser } from "../auth/repository.js";
import { requireAuthenticated, requireRoles } from "../auth/authorization.js";
import type { AuthRepository } from "../auth/repository.js";
import { validateRequest } from "../middleware/validate-request.js";
import { ApiRequestError } from "../request-error.js";
import type { PatientRepository } from "./types.js";
import { PatientService } from "./service.js";

const optionalText = (max: number) => z.string().trim().max(max).optional().nullable().transform((value) => value || null);
const profileSchema = z.object({
  givenName: z.string().trim().min(1).max(80),
  familyName: z.string().trim().min(1).max(80),
  dateOfBirth: z.string().date().refine((value) => value < new Date().toISOString().slice(0, 10), "Invalid value"),
  phone: z.string().trim().regex(/^\+?[0-9 ()-]{7,24}$/),
  addressLine: optionalText(160),
  city: optionalText(80),
  postalCode: optionalText(20)
}).strict();

function currentPatient(response: Parameters<import("express").RequestHandler>[1]): PublicUser {
  const user = response.locals.user as PublicUser | undefined;
  if (!user) throw new ApiRequestError(401, "UNAUTHENTICATED", "Authentication is required.");
  return user;
}

export function createPatientRouter(authRepository: AuthRepository, patientRepository: PatientRepository, cookieName: string): Router {
  const router = Router();
  const service = new PatientService(patientRepository);
  router.use(requireAuthenticated(authRepository, cookieName), requireRoles("Patient"));

  router.get("/me", async (_request, response, next) => {
    try {
      const profile = await service.getProfile(currentPatient(response).id);
      response.json({ success: true, data: { profile: profile ?? null, complete: profile !== undefined }, meta: { requestId: response.locals.requestId } });
    } catch (error) { next(error); }
  });

  router.put("/me", validateRequest({ body: profileSchema }), async (_request, response, next) => {
    try {
      const profile = await service.saveProfile(currentPatient(response).id, response.locals.validated.body as z.infer<typeof profileSchema>);
      response.json({ success: true, data: { profile, complete: true }, meta: { requestId: response.locals.requestId } });
    } catch (error) { next(error); }
  });

  return router;
}
