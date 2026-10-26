import { Router } from "express";
import { z } from "zod";
import type { AuthRepository, PublicUser } from "../auth/repository.js";
import { requireAuthenticated, requireRoles } from "../auth/authorization.js";
import type { AppointmentRepository } from "../appointments/types.js";
import type { DoctorRepository } from "../doctors/types.js";
import { validateRequest } from "../middleware/validate-request.js";
import { ApiRequestError } from "../request-error.js";
import type { PrescriptionRepository } from "./types.js";
import { PrescriptionService } from "./service.js";

const uuid = z.string().uuid();
const createSchema = z.object({
  patientId: uuid,
  appointmentId: uuid,
  medicationName: z.string().trim().min(1).max(200),
  dosage: z.string().trim().min(1).max(120),
  route: z.string().trim().min(1).max(80),
  frequency: z.string().trim().min(1).max(120),
  durationDays: z.number().int().min(1).max(3650),
  instructions: z.string().trim().max(2000).optional().nullable().transform((value) => value || null)
}).strict();
const doctorQuery = z.object({ patientId: uuid }).strict();

function currentUser(response: Parameters<import("express").RequestHandler>[1]): PublicUser {
  const user = response.locals.user as PublicUser | undefined;
  if (!user) throw new ApiRequestError(401, "UNAUTHENTICATED", "Authentication is required.");
  return user;
}

export function createPrescriptionRouter(auth: AuthRepository, repository: PrescriptionRepository, appointments: AppointmentRepository, doctors: DoctorRepository, cookieName: string): Router {
  const router = Router();
  const service = new PrescriptionService(repository, appointments, doctors);
  router.get("/me", requireAuthenticated(auth, cookieName), requireRoles("Patient"), async (_request, response, next) => {
    try {
      const user = currentUser(response);
      const prescriptions = await service.listForPatient(user.id, response.locals.requestId);
      response.json({ success: true, data: { prescriptions }, meta: { requestId: response.locals.requestId } });
    } catch (error) { next(error); }
  });
  router.get("/doctor", requireAuthenticated(auth, cookieName), requireRoles("Doctor"), validateRequest({ query: doctorQuery }), async (_request, response, next) => {
    try {
      const user = currentUser(response);
      const { patientId } = response.locals.validated.query as z.infer<typeof doctorQuery>;
      const prescriptions = await service.listForDoctor(user.id, patientId, response.locals.requestId);
      response.json({ success: true, data: { prescriptions }, meta: { requestId: response.locals.requestId } });
    } catch (error) { next(error); }
  });
  router.post("/doctor", requireAuthenticated(auth, cookieName), requireRoles("Doctor"), validateRequest({ body: createSchema }), async (_request, response, next) => {
    try {
      const user = currentUser(response);
      const input = response.locals.validated.body as z.infer<typeof createSchema>;
      const prescription = await service.create(user.id, input, response.locals.requestId);
      response.status(201).json({ success: true, data: { prescription }, meta: { requestId: response.locals.requestId } });
    } catch (error) { next(error); }
  });
  return router;
}
