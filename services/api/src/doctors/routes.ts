import { Router } from "express";
import { z } from "zod";
import type { AuthRepository, PublicUser } from "../auth/repository.js";
import { requireAuthenticated, requireRoles } from "../auth/authorization.js";
import { validateRequest } from "../middleware/validate-request.js";
import { ApiRequestError } from "../request-error.js";
import type { DoctorApprovalStatus, DoctorRepository } from "./types.js";
import { DoctorService } from "./service.js";

const profileSchema = z.object({
  givenName: z.string().trim().min(1).max(80),
  familyName: z.string().trim().min(1).max(80),
  specialization: z.string().trim().min(2).max(100),
  qualification: z.string().trim().max(160).optional().nullable().transform((value) => value || null),
  experienceYears: z.number().int().min(0).max(60).optional().nullable().transform((value) => value ?? null),
  bio: z.string().trim().max(1200).optional().nullable().transform((value) => value || null),
  licenseNumber: z.string().trim().min(3).max(512).optional().nullable().transform((value) => value || null),
  licenseJurisdiction: z.string().trim().min(2).max(120).optional().nullable().transform((value) => value || null)
}).strict();

const availabilitySchema = z.object({
  slots: z.array(z.object({
    startsAt: z.string().datetime({ offset: true }),
    endsAt: z.string().datetime({ offset: true })
  }).strict().refine((slot) => Date.parse(slot.endsAt) > Date.parse(slot.startsAt), "Invalid value")).max(50)
    .refine((slots) => slots.every((slot) => Date.parse(slot.startsAt) > Date.now()), "Invalid value")
    .refine((slots) => slots.every((slot, index) => slots.slice(index + 1).every((other) => Date.parse(slot.endsAt) <= Date.parse(other.startsAt) || Date.parse(other.endsAt) <= Date.parse(slot.startsAt))), "Invalid value")
}).strict();

const directoryQuery = z.object({ specialization: z.string().trim().min(2).max(100).optional() }).strict();
const approvalSchema = z.object({ status: z.enum(["approved", "rejected", "suspended"]) }).strict();
const licenseReviewSchema = z.object({ status: z.enum(["verified", "rejected"]), note: z.string().trim().min(5).max(500) }).strict();

function currentUser(response: Parameters<import("express").RequestHandler>[1]): PublicUser {
  const user = response.locals.user as PublicUser | undefined;
  if (!user) throw new ApiRequestError(401, "UNAUTHENTICATED", "Authentication is required.");
  return user;
}

export function createDoctorRouter(authRepository: AuthRepository, doctorRepository: DoctorRepository, cookieName: string): Router {
  const router = Router();
  const service = new DoctorService(doctorRepository);

  // Public directory only exposes approved profiles. Private fields are selected out by the repository.
  router.get("/directory", validateRequest({ query: directoryQuery }), async (_request, response, next) => {
    try {
      const query = response.locals.validated.query as z.infer<typeof directoryQuery>;
      const doctors = await service.listDirectory(query.specialization);
      response.json({ success: true, data: { doctors }, meta: { requestId: response.locals.requestId } });
    } catch (error) { next(error); }
  });

  router.get("/directory/:id", validateRequest({ params: z.object({ id: z.string().uuid() }) }), async (_request, response, next) => {
    try {
      const id = (response.locals.validated.params as { id: string }).id;
      const doctor = await service.getPublicProfile(id);
      response.json({ success: true, data: { doctor }, meta: { requestId: response.locals.requestId } });
    } catch (error) { next(error); }
  });

  router.get("/pending", requireAuthenticated(authRepository, cookieName), requireRoles("Admin"), async (_request, response, next) => {
    try {
      const doctors = await service.listPending();
      response.json({ success: true, data: { doctors }, meta: { requestId: response.locals.requestId } });
    } catch (error) { next(error); }
  });

  router.get("/me", requireAuthenticated(authRepository, cookieName), requireRoles("Doctor"), async (_request, response, next) => {
    try {
      const profile = await service.getOwnProfile(currentUser(response).id);
      response.json({ success: true, data: { profile: profile ?? null, complete: profile !== undefined }, meta: { requestId: response.locals.requestId } });
    } catch (error) { next(error); }
  });

  router.put("/me", requireAuthenticated(authRepository, cookieName), requireRoles("Doctor"), validateRequest({ body: profileSchema }), async (_request, response, next) => {
    try {
      const profile = await service.saveOwnProfile(currentUser(response).id, response.locals.validated.body as z.infer<typeof profileSchema>);
      response.json({ success: true, data: { profile, complete: true }, meta: { requestId: response.locals.requestId } });
    } catch (error) { next(error); }
  });

  router.put("/me/availability", requireAuthenticated(authRepository, cookieName), requireRoles("Doctor"), validateRequest({ body: availabilitySchema }), async (_request, response, next) => {
    try {
      const { slots } = response.locals.validated.body as z.infer<typeof availabilitySchema>;
      const availability = await service.updateAvailability(currentUser(response).id, slots);
      response.json({ success: true, data: { availability }, meta: { requestId: response.locals.requestId } });
    } catch (error) { next(error); }
  });

  router.patch("/:id/approval", requireAuthenticated(authRepository, cookieName), requireRoles("Admin"), validateRequest({ params: z.object({ id: z.string().uuid() }), body: approvalSchema }), async (_request, response, next) => {
    try {
      const { id } = response.locals.validated.params as { id: string };
      const { status } = response.locals.validated.body as { status: DoctorApprovalStatus };
      const profile = await service.setApprovalStatus(id, status, currentUser(response).id, response.locals.requestId);
      response.json({ success: true, data: { profile }, meta: { requestId: response.locals.requestId } });
    } catch (error) { next(error); }
  });

  router.patch("/:id/license-review", requireAuthenticated(authRepository, cookieName), requireRoles("Admin"), validateRequest({ params: z.object({ id: z.string().uuid() }), body: licenseReviewSchema }), async (_request, response, next) => {
    try {
      const { id } = response.locals.validated.params as { id: string };
      const { status, note } = response.locals.validated.body as z.infer<typeof licenseReviewSchema>;
      if (!doctorRepository.reviewLicense) throw new ApiRequestError(503, "LICENSE_REVIEW_UNAVAILABLE", "License review is unavailable.");
      const profile = await doctorRepository.reviewLicense(id, status, note, currentUser(response).id, response.locals.requestId);
      if (!profile) throw new ApiRequestError(404, "DOCTOR_NOT_FOUND", "Doctor profile was not found.");
      response.json({ success: true, data: { profile }, meta: { requestId: response.locals.requestId } });
    } catch (error) { next(error); }
  });

  return router;
}
