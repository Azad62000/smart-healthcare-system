import { Router } from "express";
import { z } from "zod";
import type { AuthRepository, PublicUser } from "../auth/repository.js";
import { requireAuthenticated, requireRoles } from "../auth/authorization.js";
import { validateRequest } from "../middleware/validate-request.js";
import { ApiRequestError } from "../request-error.js";
import type { AdminAppointmentRepository, AppointmentType, ScheduleInput } from "./admin-repository.js";

const uuid = z.string().uuid();
const scheduleSchema = z.object({
  patientId: uuid,
  doctorId: uuid,
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }),
  type: z.enum(["in_person", "video"]),
  schedulingNote: z.string().trim().max(1000).optional().nullable(),
  adminNote: z.string().trim().max(2000).optional().nullable()
}).strict().refine((input) => Date.parse(input.endsAt) > Date.parse(input.startsAt), "Invalid appointment interval");
const rescheduleSchema = z.object({
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true })
}).strict().refine((input) => Date.parse(input.endsAt) > Date.parse(input.startsAt), "Invalid appointment interval");
const cancelSchema = z.object({ reason: z.string().trim().max(240).optional() }).strict();
const availabilityQuery = z.object({
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }),
  type: z.enum(["in_person", "video"]),
  specialization: z.string().trim().min(2).max(100).optional(),
  city: z.string().trim().min(2).max(80).optional(),
  minimumExperience: z.coerce.number().int().min(0).max(60).optional(),
  maximumFee: z.coerce.number().int().min(0).max(1_000_000).optional()
}).strict().refine((query) => Date.parse(query.endsAt) > Date.parse(query.startsAt), "Invalid appointment interval");
const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  view: z.enum(["all", "pending", "upcoming"]).default("all"),
  status: z.enum(["booked", "confirmed", "cancelled", "completed", "no_show"]).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional()
}).strict().refine((query) => !query.from || !query.to || Date.parse(query.to) > Date.parse(query.from), "Invalid appointment range");

function currentUser(response: Parameters<import("express").RequestHandler>[1]): PublicUser {
  const user = response.locals.user as PublicUser | undefined;
  if (!user) throw new ApiRequestError(401, "UNAUTHENTICATED", "Authentication is required.");
  return user;
}

export function createAdminAppointmentRouter(auth: AuthRepository, repository: AdminAppointmentRepository, cookieName: string): Router {
  const router = Router();
  router.use(requireAuthenticated(auth, cookieName), requireRoles("Admin"));

  router.get("/options", async (_request, response, next) => {
    try {
      const options = await repository.listOptions();
      response.json({ success: true, data: options, meta: { requestId: response.locals.requestId } });
    } catch (error) { next(error); }
  });

  router.get("/availability", validateRequest({ query: availabilityQuery }), async (_request, response, next) => {
    try {
      const filters = response.locals.validated.query as z.infer<typeof availabilityQuery>;
      if (Date.parse(filters.startsAt) <= Date.now()) throw new ApiRequestError(400, "INVALID_APPOINTMENT_TIME", "Availability can only be checked for future times.");
      const doctors = await repository.checkDoctorAvailability(filters);
      response.json({ success: true, data: { doctors }, meta: { requestId: response.locals.requestId } });
    } catch (error) { next(error); }
  });

  router.get("/", validateRequest({ query: listQuery }), async (_request, response, next) => {
    try {
      const query = response.locals.validated.query as z.infer<typeof listQuery>;
      const result = await repository.list(query);
      response.json({ success: true, data: result, meta: { requestId: response.locals.requestId } });
    } catch (error) { next(error); }
  });

  router.post("/", validateRequest({ body: scheduleSchema }), async (_request, response, next) => {
    try {
      const input = response.locals.validated.body as z.infer<typeof scheduleSchema>;
      if (Date.parse(input.startsAt) <= Date.now()) throw new ApiRequestError(400, "INVALID_APPOINTMENT_TIME", "Appointments must be scheduled in the future.");
      const appointment = await repository.create({
        ...input,
        type: input.type as AppointmentType,
        schedulingNote: input.schedulingNote ?? null,
        adminNote: input.adminNote ?? null
      } satisfies ScheduleInput, currentUser(response).id);
      response.status(201).json({ success: true, data: { appointment }, meta: { requestId: response.locals.requestId } });
    } catch (error) {
      if ((error as { code?: string }).code === "SCHEDULING_PARTICIPANT_INVALID") {
        next(new ApiRequestError(400, "SCHEDULING_PARTICIPANT_INVALID", "Select an active patient and an active, approved doctor."));
      } else if ((error as { code?: string }).code === "APPOINTMENT_CONFLICT") {
        next(new ApiRequestError(409, "APPOINTMENT_CONFLICT", "The patient or doctor already has an appointment at that time."));
      } else if ((error as { code?: string }).code === "DOCTOR_UNAVAILABLE") {
        next(new ApiRequestError(409, "DOCTOR_UNAVAILABLE", "The doctor is not accepting this appointment type or time."));
      } else next(error);
    }
  });

  router.patch("/:id/reschedule", validateRequest({ params: z.object({ id: uuid }), body: rescheduleSchema }), async (_request, response, next) => {
    try {
      const { id } = response.locals.validated.params as { id: string };
      const input = response.locals.validated.body as z.infer<typeof rescheduleSchema>;
      if (Date.parse(input.startsAt) <= Date.now()) throw new ApiRequestError(400, "INVALID_APPOINTMENT_TIME", "Appointments must be rescheduled to a future time.");
      const appointment = await repository.reschedule(id, input.startsAt, input.endsAt, currentUser(response).id);
      if (!appointment) throw new ApiRequestError(409, "INVALID_STATUS_TRANSITION", "Only booked or confirmed appointments can be rescheduled.");
      response.json({ success: true, data: { appointment }, meta: { requestId: response.locals.requestId } });
    } catch (error) {
      if ((error as { code?: string }).code === "APPOINTMENT_CONFLICT") next(new ApiRequestError(409, "APPOINTMENT_CONFLICT", "The patient or doctor already has an appointment at that time."));
      else if ((error as { code?: string }).code === "DOCTOR_UNAVAILABLE") next(new ApiRequestError(409, "DOCTOR_UNAVAILABLE", "The doctor is not accepting this appointment type or time."));
      else next(error);
    }
  });

  router.post("/:id/cancel", validateRequest({ params: z.object({ id: uuid }), body: cancelSchema }), async (_request, response, next) => {
    try {
      const { id } = response.locals.validated.params as { id: string };
      const { reason } = response.locals.validated.body as z.infer<typeof cancelSchema>;
      const appointment = await repository.cancel(id, currentUser(response).id, reason);
      if (!appointment) throw new ApiRequestError(409, "INVALID_STATUS_TRANSITION", "Only booked or confirmed appointments can be cancelled.");
      response.json({ success: true, data: { appointment }, meta: { requestId: response.locals.requestId } });
    } catch (error) { next(error); }
  });

  return router;
}
