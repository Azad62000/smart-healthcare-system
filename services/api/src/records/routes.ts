import { Router } from "express";
import { z } from "zod";
import type { AuthRepository, PublicUser } from "../auth/repository.js";
import { requireAuthenticated, requireRoles } from "../auth/authorization.js";
import { validateRequest } from "../middleware/validate-request.js";
import { ApiRequestError } from "../request-error.js";
import type { AppointmentRepository } from "../appointments/types.js";
import type { DoctorRepository } from "../doctors/types.js";
import type { RecordRepository } from "./types.js";
import { RecordService } from "./service.js";

const uuid = z.string().uuid();
const patientQuery = z.object({ patientId: uuid.optional() }).strict();
const createSchema = z.object({
  patientId: uuid,
  appointmentId: uuid.optional().nullable(),
  consultationAt: z.string().datetime({ offset: true }).optional(),
  note: z.string().trim().min(1).max(10000),
  diagnosis: z.string().trim().max(2000).optional().nullable()
}).strict();

function currentUser(response: Parameters<import("express").RequestHandler>[1]): PublicUser {
  const user = response.locals.user as PublicUser | undefined;
  if (!user) throw new ApiRequestError(401, "UNAUTHENTICATED", "Authentication is required.");
  return user;
}

export function createRecordRouter(auth: AuthRepository, records: RecordRepository, appointments: AppointmentRepository, doctors: DoctorRepository, cookieName: string): Router {
  const router = Router();
  const service = new RecordService(records, appointments, doctors);

  router.get("/me", requireAuthenticated(auth, cookieName), requireRoles("Patient"), async (_req, res, next) => {
    try { const user = currentUser(res); const data = await service.patientRecords(user.id, user.id, res.locals.requestId); res.json({ success: true, data: { records: data }, meta: { requestId: res.locals.requestId } }); }
    catch (error) { next(error); }
  });

  router.get("/me/:id", requireAuthenticated(auth, cookieName), requireRoles("Patient"), validateRequest({ params: z.object({ id: uuid }) }), async (_req, res, next) => {
    try { const user = currentUser(res); const { id } = res.locals.validated.params as { id: string }; const record = await service.patientRecord(id, user.id, user.id, res.locals.requestId); res.json({ success: true, data: { record }, meta: { requestId: res.locals.requestId } }); }
    catch (error) { next(error); }
  });

  router.get("/doctor", requireAuthenticated(auth, cookieName), requireRoles("Doctor"), validateRequest({ query: patientQuery }), async (_req, res, next) => {
    try { const user = currentUser(res); const { patientId } = res.locals.validated.query as z.infer<typeof patientQuery>; const data = await service.doctorRecords(user.id, patientId, res.locals.requestId); res.json({ success: true, data: { records: data }, meta: { requestId: res.locals.requestId } }); }
    catch (error) { next(error); }
  });

  router.post("/doctor", requireAuthenticated(auth, cookieName), requireRoles("Doctor"), validateRequest({ body: createSchema }), async (_req, res, next) => {
    try { const user = currentUser(res); const input = res.locals.validated.body as z.infer<typeof createSchema>; const record = await service.createDoctorRecord(user.id, input, res.locals.requestId); res.status(201).json({ success: true, data: { record }, meta: { requestId: res.locals.requestId } }); }
    catch (error) { next(error); }
  });
  return router;
}
