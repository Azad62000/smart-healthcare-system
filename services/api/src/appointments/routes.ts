import { Router } from "express";
import { z } from "zod";
import type { AuthRepository, PublicUser } from "../auth/repository.js";
import { requireAuthenticated, requireRoles } from "../auth/authorization.js";
import { validateRequest } from "../middleware/validate-request.js";
import { ApiRequestError } from "../request-error.js";
import type { AppointmentRepository, AppointmentStatus } from "./types.js";
import { AppointmentService } from "./service.js";

const uuid = z.string().uuid();
const listQuery = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  timeZone: z.string().min(1).max(80).default("UTC")
}).strict().refine((query) => !query.from || !query.to || Date.parse(query.to) > Date.parse(query.from), "Invalid value").refine((query) => {
  try { new Intl.DateTimeFormat("en", { timeZone: query.timeZone }); return true; } catch { return false; }
}, "Invalid value");
const bookSchema = z.object({ doctorId: uuid, startsAt: z.string().datetime({ offset: true }), endsAt: z.string().datetime({ offset: true }), type: z.enum(["in_person", "video"]).default("in_person") }).strict();
const cancelSchema = z.object({ reason: z.string().trim().max(240).optional() }).strict();
const transitionSchema = z.object({ status: z.enum(["confirmed", "completed", "no_show"]) }).strict();

function actor(response: Parameters<import("express").RequestHandler>[1]): PublicUser {
  const user = response.locals.user as PublicUser | undefined;
  if (!user) throw new ApiRequestError(401, "UNAUTHENTICATED", "Authentication is required.");
  return user;
}

export function createAppointmentRouter(authRepository: AuthRepository, repository: AppointmentRepository, cookieName: string): Router {
  const router = Router();
  const service = new AppointmentService(repository);

  router.get("/available-slots", validateRequest({ query: z.object({ doctorId: uuid, from: z.string().datetime({ offset: true }), to: z.string().datetime({ offset: true }), timeZone: z.string().min(1).max(80).default("UTC"), type: z.enum(["in_person", "video"]).optional() }).strict().refine((q) => Date.parse(q.to) > Date.parse(q.from), "Invalid value").refine((q) => { try { new Intl.DateTimeFormat("en", { timeZone: q.timeZone }); return true; } catch { return false; } }, "Invalid value") }), async (_req, res, next) => {
    try {
      const query = res.locals.validated.query as { doctorId: string; from: string; to: string; timeZone: string; type?: "in_person" | "video" };
      const slots = await service.available(query.doctorId, query.from, query.to, query.type);
      res.json({ success: true, data: { slots, timeZone: query.timeZone }, meta: { requestId: res.locals.requestId } });
    } catch (error) { next(error); }
  });

  router.post("/", requireAuthenticated(authRepository, cookieName), requireRoles("Patient"), validateRequest({ body: bookSchema }), async (_req, res, next) => {
    try {
      const input = res.locals.validated.body as z.infer<typeof bookSchema>;
      const appointment = await service.book(actor(res).id, input.doctorId, input.startsAt, input.endsAt, input.type);
      res.status(201).json({ success: true, data: { appointment }, meta: { requestId: res.locals.requestId } });
    } catch (error) { next(error); }
  });

  router.get("/me", requireAuthenticated(authRepository, cookieName), requireRoles("Patient"), validateRequest({ query: listQuery }), async (_req, res, next) => {
    try {
      const query = res.locals.validated.query as z.infer<typeof listQuery>;
      const appointments = await service.listForPatient(actor(res).id, query.from, query.to);
      res.json({ success: true, data: { appointments: appointments.map(({ id, startsAt, endsAt, status, doctorDisplayName, specialization, type, schedulingNote }) => ({ id, startsAt, endsAt, status, doctorDisplayName, specialization, type, schedulingNote })), timeZone: query.timeZone }, meta: { requestId: res.locals.requestId } });
    } catch (error) { next(error); }
  });

  router.get("/doctor/me", requireAuthenticated(authRepository, cookieName), requireRoles("Doctor"), validateRequest({ query: listQuery }), async (_req, res, next) => {
    try {
      const query = res.locals.validated.query as z.infer<typeof listQuery>;
      const appointments = await service.listForDoctor(actor(res).id, query.from, query.to);
      res.json({ success: true, data: { appointments, timeZone: query.timeZone }, meta: { requestId: res.locals.requestId } });
    } catch (error) { next(error); }
  });

  router.post("/:id/cancel", requireAuthenticated(authRepository, cookieName), requireRoles("Patient", "Doctor"), validateRequest({ params: z.object({ id: uuid }), body: cancelSchema }), async (_req, res, next) => {
    try {
      const user = actor(res);
      const { id } = res.locals.validated.params as { id: string };
      const { reason } = res.locals.validated.body as z.infer<typeof cancelSchema>;
      const appointment = await service.cancel(id, user.id, user.role as "Patient" | "Doctor", reason);
      res.json({ success: true, data: { appointment }, meta: { requestId: res.locals.requestId } });
    } catch (error) { next(error); }
  });

  router.patch("/:id/status", requireAuthenticated(authRepository, cookieName), requireRoles("Doctor"), validateRequest({ params: z.object({ id: uuid }), body: transitionSchema }), async (_req, res, next) => {
    try {
      const user = actor(res);
      const { id } = res.locals.validated.params as { id: string };
      const { status } = res.locals.validated.body as { status: AppointmentStatus };
      const appointment = await service.transition(id, user.id, "Doctor", status);
      res.json({ success: true, data: { appointment }, meta: { requestId: res.locals.requestId } });
    } catch (error) { next(error); }
  });
  return router;
}
