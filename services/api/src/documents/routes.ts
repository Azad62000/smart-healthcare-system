import { Router } from "express";
import type { Request, Response } from "express";
import { pipeline } from "node:stream/promises";
import type { AuthRepository, PublicUser } from "../auth/repository.js";
import { requireAuthenticated } from "../auth/authorization.js";
import type { Appointment, AppointmentRepository } from "../appointments/types.js";
import { ApiRequestError } from "../request-error.js";
import { log } from "../logger.js";
import { PrivateDocumentStorage } from "./storage.js";
import type { AppointmentDocumentRepository } from "./types.js";
import { z } from "zod";

function currentUser(response: Response): PublicUser {
  const user = response.locals.user as PublicUser | undefined;
  if (!user) throw new ApiRequestError(401, "UNAUTHENTICATED", "Authentication is required.");
  if (user.role !== "Patient" && user.role !== "Doctor") {
    throw new ApiRequestError(403, "FORBIDDEN", "Only appointment participants can access documents.");
  }
  return user;
}

async function authorizedAppointment(repository: AppointmentRepository, appointmentId: string, user: PublicUser): Promise<Appointment> {
  const appointment = await repository.findForActor(appointmentId, user.id, user.role);
  if (!appointment) throw new ApiRequestError(404, "APPOINTMENT_NOT_FOUND", "Appointment was not found.");
  return appointment;
}

function routeError(response: Response, error: unknown, next: (error: unknown) => void) {
  if (response.headersSent) {
    response.destroy(error instanceof Error ? error : undefined);
    return;
  }
  next(error);
}

export function createAppointmentDocumentRouter(
  auth: AuthRepository,
  appointments: AppointmentRepository,
  documents: AppointmentDocumentRepository,
  storage: PrivateDocumentStorage,
  cookieName: string
): Router {
  const router = Router();
  router.use(requireAuthenticated(auth, cookieName));
  const appointmentParams = z.object({ appointmentId: z.string().uuid() }).strict();
  const documentParams = z.object({ appointmentId: z.string().uuid(), documentId: z.string().uuid() }).strict();

  router.get("/appointments/:appointmentId/documents", async (request, response, next) => {
    try {
      const user = currentUser(response);
      const params = appointmentParams.parse(request.params);
      await authorizedAppointment(appointments, params.appointmentId, user);
      const result = await documents.list(params.appointmentId, user.id, response.locals.requestId);
      response.json({ success: true, data: { documents: result }, meta: { requestId: response.locals.requestId } });
    } catch (error) { routeError(response, error, next); }
  });

  router.post("/appointments/:appointmentId/documents", async (request, response, next) => {
    let saved: Awaited<ReturnType<PrivateDocumentStorage["save"]>> | undefined;
    try {
      const user = currentUser(response);
      const params = appointmentParams.parse(request.params);
      const appointment = await authorizedAppointment(appointments, params.appointmentId, user);
      saved = await storage.save(request as Request, request.header("x-file-name"));
      try {
        const document = await documents.create({
          appointmentId: appointment.id,
          patientId: appointment.patientId,
          doctorId: appointment.doctorId,
          uploaderUserId: user.id,
          storageKey: saved.storageKey,
          filename: saved.filename,
          mediaType: saved.mediaType,
          byteSize: saved.byteSize,
          storageFormat: saved.storageFormat,
          requestId: response.locals.requestId
        });
        response.status(201).json({ success: true, data: { document }, meta: { requestId: response.locals.requestId } });
      } catch (error) {
        try { await storage.remove(saved.storageKey, saved.mediaType); }
        catch { log("error", "documents.orphan_cleanup.failed", { requestId: response.locals.requestId }); }
        throw error;
      }
    } catch (error) { routeError(response, error, next); }
  });

  router.get("/appointments/:appointmentId/documents/:documentId", async (request, response, next) => {
    try {
      const user = currentUser(response);
      const params = documentParams.parse(request.params);
      await authorizedAppointment(appointments, params.appointmentId, user);
      const document = await documents.findForDownload(params.appointmentId, params.documentId, user.id, response.locals.requestId);
      if (!document) throw new ApiRequestError(404, "DOCUMENT_NOT_FOUND", "Document was not found.");
      response.setHeader("Content-Type", document.mediaType);
      response.setHeader("Content-Length", String(document.byteSize));
      response.setHeader("X-Content-Type-Options", "nosniff");
      response.setHeader("Cache-Control", "private, no-store");
      const safeFilename = document.filename.replace(/[^\x20-\x7e]|["\\]/g, "_");
      response.setHeader("Content-Disposition", `attachment; filename="${safeFilename}"; filename*=UTF-8''${encodeURIComponent(document.filename)}`);
      await pipeline(await storage.open(document.storageKey, document.mediaType, document.storageFormat), response);
    } catch (error) { routeError(response, error, next); }
  });

  router.delete("/appointments/:appointmentId/documents/:documentId", async (request, response, next) => {
    try {
      const user = currentUser(response);
      const params = documentParams.parse(request.params);
      await authorizedAppointment(appointments, params.appointmentId, user);
      const removed = await documents.delete(params.appointmentId, params.documentId, user.id, response.locals.requestId);
      if (!removed) throw new ApiRequestError(409, "DOCUMENT_DELETE_NOT_ALLOWED", "Only the uploader may remove a document before the appointment starts.");
      await storage.remove(removed.storageKey, removed.mediaType);
      response.json({ success: true, data: { deleted: true }, meta: { requestId: response.locals.requestId } });
    } catch (error) { routeError(response, error, next); }
  });

  return router;
}
