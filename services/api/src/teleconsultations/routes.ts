import { AccessToken } from "livekit-server-sdk";
import { Router } from "express";
import { z } from "zod";
import type { Pool } from "pg";
import type { AuthRepository, PublicUser } from "../auth/repository.js";
import { requireAuthenticated } from "../auth/authorization.js";
import { config } from "../config.js";
import { ApiRequestError } from "../request-error.js";
import { validateRequest } from "../middleware/validate-request.js";

interface ConsultationRow {
  appointment_id: string;
  patient_id: string;
  patient_display_name: string;
  doctor_id: string;
  doctor_user_id: string;
  doctor_display_name: string;
  starts_at: Date;
  ends_at: Date;
  appointment_status: string;
  appointment_type: "in_person" | "video";
  room_name: string;
  status: string;
  doctor_joined_at: Date | null;
  patient_joined_at: Date | null;
  actual_started_at: Date | null;
  actual_ended_at: Date | null;
  termination_reason: string | null;
}

function currentUser(response: Parameters<import("express").RequestHandler>[1]): PublicUser {
  const user = response.locals.user as PublicUser | undefined;
  if (!user) throw new ApiRequestError(401, "UNAUTHENTICATED", "Authentication is required.");
  return user;
}

async function findConsultation(db: Pool, appointmentId: string): Promise<ConsultationRow | undefined> {
  const { rows } = await db.query<ConsultationRow>(
    `SELECT a.id AS appointment_id,a.patient_id,
      p.given_name || ' ' || p.family_name AS patient_display_name,
      d.id AS doctor_id,d.user_id AS doctor_user_id,
      d.given_name || ' ' || d.family_name AS doctor_display_name,
      a.starts_at,a.ends_at,a.status AS appointment_status,a.appointment_type,
      tc.room_name,tc.status,tc.doctor_joined_at,tc.patient_joined_at,
      tc.actual_started_at,tc.actual_ended_at,tc.termination_reason
     FROM appointments a
     JOIN teleconsultations tc ON tc.appointment_id=a.id
     JOIN patients p ON p.user_id=a.patient_id
     JOIN doctors d ON d.id=a.doctor_id
     WHERE a.id=$1`,
    [appointmentId]
  );
  return rows[0];
}

function participant(row: ConsultationRow, user: PublicUser): "Patient" | "Doctor" | undefined {
  if (user.role === "Patient" && user.id === row.patient_id) return "Patient";
  if (user.role === "Doctor" && user.id === row.doctor_user_id) return "Doctor";
  return undefined;
}

function publicConsultation(row: ConsultationRow) {
  return {
    appointmentId: row.appointment_id,
    patientDisplayName: row.patient_display_name,
    doctorDisplayName: row.doctor_display_name,
    startsAt: row.starts_at.toISOString(),
    endsAt: row.ends_at.toISOString(),
    appointmentStatus: row.appointment_status,
    type: row.appointment_type,
    status: row.status,
    doctorJoinedAt: row.doctor_joined_at?.toISOString() ?? null,
    patientJoinedAt: row.patient_joined_at?.toISOString() ?? null,
    actualStartedAt: row.actual_started_at?.toISOString() ?? null,
    actualEndedAt: row.actual_ended_at?.toISOString() ?? null,
    terminationReason: row.termination_reason
  };
}

export function createTeleconsultationRouter(auth: AuthRepository, db: Pool, cookieName: string): Router {
  const router = Router();
  const appointmentParams = validateRequest({ params: z.object({ appointmentId: z.string().uuid() }) });
    const noteRequest = validateRequest({
      params: z.object({ appointmentId: z.string().uuid() }),
      body: z.object({
        summary: z.string().trim().min(1).max(10000),
        symptoms: z.string().trim().max(5000).nullable().optional(),
        observations: z.string().trim().max(5000).nullable().optional(),
        assessment: z.string().trim().max(5000).nullable().optional(),
        followUp: z.string().trim().max(5000).nullable().optional(),
        internalNotes: z.string().trim().max(10000).nullable().optional()
      })
    });

  router.get("/:appointmentId", requireAuthenticated(auth, cookieName), appointmentParams, async (request, response, next) => {
    try {
      const { appointmentId } = response.locals.validated.params as { appointmentId: string };
      const row = await findConsultation(db, appointmentId);
      if (!row) throw new ApiRequestError(404, "CONSULTATION_NOT_FOUND", "Video consultation was not found.");
      const user = currentUser(response);
      if (!participant(row, user) && user.role !== "Admin") throw new ApiRequestError(403, "FORBIDDEN", "You are not assigned to this consultation.");
      response.json({ success: true, data: { consultation: publicConsultation(row) }, meta: { requestId: response.locals.requestId } });
    } catch (error) { next(error); }
  });

  router.post("/:appointmentId/token", requireAuthenticated(auth, cookieName), appointmentParams, async (_request, response, next) => {
    try {
      const { appointmentId } = response.locals.validated.params as { appointmentId: string };
      const user = currentUser(response);
      if (user.role === "Admin") throw new ApiRequestError(403, "FORBIDDEN", "Administrators can review consultation metadata but cannot join the video call.");
      if (!config.LIVEKIT_URL || !config.LIVEKIT_API_KEY || !config.LIVEKIT_API_SECRET) {
        throw new ApiRequestError(503, "VIDEO_PROVIDER_NOT_CONFIGURED", "Video consultations are unavailable because LiveKit is not configured.");
      }
      const row = await findConsultation(db, appointmentId);
      if (!row) throw new ApiRequestError(404, "CONSULTATION_NOT_FOUND", "Video consultation was not found.");
      const role = participant(row, user);
      if (!role) throw new ApiRequestError(403, "FORBIDDEN", "You are not assigned to this consultation.");
      const now = Date.now();
      const startsAt = row.starts_at.getTime();
      const endsAt = row.ends_at.getTime();
      const allowance = config.TELECONSULTATION_JOIN_WINDOW_MINUTES * 60_000;
      if (row.appointment_type !== "video" || !["booked", "confirmed"].includes(row.appointment_status) ||
          now < startsAt - allowance || now > endsAt || row.actual_ended_at) {
        throw new ApiRequestError(409, "CONSULTATION_NOT_JOINABLE", "This video consultation is not currently available to join.");
      }
      const token = new AccessToken(config.LIVEKIT_API_KEY, config.LIVEKIT_API_SECRET, {
        identity: user.id,
        name: role === "Doctor" ? row.doctor_display_name : row.patient_display_name,
        ttl: "10m",
        metadata: JSON.stringify({ appointmentId, role })
      });
      token.addGrant({ roomJoin: true, room: row.room_name, canPublish: true, canSubscribe: true, canPublishData: true });
      const jwt = await token.toJwt();
      response.json({
        success: true,
        data: { token: jwt, serverUrl: config.LIVEKIT_URL, consultation: publicConsultation(row) },
        meta: { requestId: response.locals.requestId }
      });
    } catch (error) { next(error); }
  });

  router.post("/:appointmentId/joined", requireAuthenticated(auth, cookieName), appointmentParams, async (_request, response, next) => {
    try {
      const { appointmentId } = response.locals.validated.params as { appointmentId: string };
      const user = currentUser(response);
      const row = await findConsultation(db, appointmentId);
      if (!row) throw new ApiRequestError(404, "CONSULTATION_NOT_FOUND", "Video consultation was not found.");
      const role = participant(row, user);
      if (!role) throw new ApiRequestError(403, "FORBIDDEN", "You are not assigned to this consultation.");
      const now = Date.now();
      const allowance = config.TELECONSULTATION_JOIN_WINDOW_MINUTES * 60_000;
      if (row.appointment_type !== "video" || !["booked", "confirmed"].includes(row.appointment_status) ||
          now < row.starts_at.getTime() - allowance || now > row.ends_at.getTime() || row.actual_ended_at) {
        throw new ApiRequestError(409, "CONSULTATION_NOT_JOINABLE", "This video consultation is not currently available to join.");
      }
      const column = role === "Doctor" ? "doctor_joined_at" : "patient_joined_at";
      const event = role === "Doctor" ? "doctor_joined" : "patient_joined";
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          `UPDATE teleconsultations SET ${column}=COALESCE(${column},now()),
           actual_started_at=COALESCE(actual_started_at,now()),status='in_progress',updated_at=now()
           WHERE appointment_id=$1`,
          [appointmentId]
        );
        await client.query(
          "INSERT INTO teleconsultation_events(appointment_id,actor_user_id,event_type) VALUES($1,$2,$3)",
          [appointmentId, user.id, event]
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally { client.release(); }
      response.json({ success: true, data: { joined: true, recordedAt: new Date().toISOString() }, meta: { requestId: response.locals.requestId } });
    } catch (error) { next(error); }
  });

  router.post("/:appointmentId/end", requireAuthenticated(auth, cookieName), appointmentParams, async (_request, response, next) => {
    try {
      const { appointmentId } = response.locals.validated.params as { appointmentId: string };
      const user = currentUser(response);
      if (user.role !== "Doctor") throw new ApiRequestError(403, "FORBIDDEN", "Only the assigned doctor can end the consultation.");
      const row = await findConsultation(db, appointmentId);
      if (!row) throw new ApiRequestError(404, "CONSULTATION_NOT_FOUND", "Video consultation was not found.");
      if (!participant(row, user)) throw new ApiRequestError(403, "FORBIDDEN", "You are not assigned to this consultation.");
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        const appointment = await client.query<{ status: string }>(
          "SELECT status FROM appointments WHERE id=$1 FOR UPDATE",
          [appointmentId]
        );
        if (!appointment.rows[0] || !["booked", "confirmed"].includes(appointment.rows[0].status)) {
          throw new ApiRequestError(409, "APPOINTMENT_NOT_ACTIVE", "Only an active appointment can be completed.");
        }
        const ended = await client.query(
          `UPDATE teleconsultations SET actual_ended_at=COALESCE(actual_ended_at,now()),
           status='completed',termination_reason='doctor_ended',updated_at=now()
           WHERE appointment_id=$1 AND actual_started_at IS NOT NULL AND actual_ended_at IS NULL
           RETURNING appointment_id`,
          [appointmentId]
        );
        if (ended.rowCount !== 1) throw new ApiRequestError(409, "CONSULTATION_NOT_ACTIVE", "Only an active consultation can be ended.");
        await client.query(
          "UPDATE appointments SET status='completed',updated_at=now() WHERE id=$1",
          [appointmentId]
        );
        await client.query(
          "INSERT INTO appointment_status_history(appointment_id,actor_user_id,from_status,to_status) VALUES($1,$2,$3,'completed')",
          [appointmentId, user.id, appointment.rows[0].status]
        );
        await client.query("INSERT INTO teleconsultation_events(appointment_id,actor_user_id,event_type,detail) VALUES($1,$2,'consultation_ended','doctor_ended')", [appointmentId, user.id]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally { client.release(); }
      response.json({ success: true, data: { ended: true }, meta: { requestId: response.locals.requestId } });
    } catch (error) { next(error); }
  });

  router.get("/:appointmentId/notes", requireAuthenticated(auth, cookieName), appointmentParams, async (_request, response, next) => {
    try {
      const { appointmentId } = response.locals.validated.params as { appointmentId: string };
      const user = currentUser(response);
      const row = await findConsultation(db, appointmentId);
      if (!row) throw new ApiRequestError(404, "CONSULTATION_NOT_FOUND", "Video consultation was not found.");
      const role = participant(row, user);
      if (!role) throw new ApiRequestError(403, "FORBIDDEN", "You are not assigned to this consultation.");
      const { rows } = await db.query(
        `SELECT summary,symptoms,observations,assessment,follow_up,
                ${role === "Doctor" ? "internal_notes" : "NULL::text AS internal_notes"},
                finalized_at
         FROM consultation_note_drafts WHERE appointment_id=$1
         ${role === "Patient" ? "AND finalized_at IS NOT NULL" : ""}`,
        [appointmentId]
      );
      if (!rows[0]) throw new ApiRequestError(404, "NOTES_NOT_FOUND", "No consultation summary is available.");
      response.json({ success: true, data: { notes: rows[0] }, meta: { requestId: response.locals.requestId } });
    } catch (error) { next(error); }
  });

  router.put("/:appointmentId/notes", requireAuthenticated(auth, cookieName), noteRequest, async (_request, response, next) => {
    try {
      const { appointmentId } = response.locals.validated.params as { appointmentId: string };
      const input = response.locals.validated.body as {
        summary: string; symptoms?: string | null; observations?: string | null;
        assessment?: string | null; followUp?: string | null; internalNotes?: string | null;
      };
      const user = currentUser(response);
      if (user.role !== "Doctor") throw new ApiRequestError(403, "FORBIDDEN", "Only the assigned doctor can edit consultation notes.");
      const row = await findConsultation(db, appointmentId);
      if (!row) throw new ApiRequestError(404, "CONSULTATION_NOT_FOUND", "Video consultation was not found.");
      if (!participant(row, user)) throw new ApiRequestError(403, "FORBIDDEN", "You are not assigned to this consultation.");
      if (row.actual_ended_at) throw new ApiRequestError(409, "CONSULTATION_ENDED", "Consultation notes can no longer be edited.");
      const { rows } = await db.query(
        `INSERT INTO consultation_note_drafts
           (appointment_id,patient_id,doctor_id,summary,symptoms,observations,assessment,follow_up,internal_notes)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (appointment_id) DO UPDATE SET
           summary=EXCLUDED.summary,symptoms=EXCLUDED.symptoms,observations=EXCLUDED.observations,
           assessment=EXCLUDED.assessment,follow_up=EXCLUDED.follow_up,internal_notes=EXCLUDED.internal_notes,
           updated_at=now()
         WHERE consultation_note_drafts.finalized_at IS NULL
         RETURNING summary,symptoms,observations,assessment,follow_up,internal_notes,finalized_at`,
        [appointmentId, row.patient_id, row.doctor_id, input.summary, input.symptoms ?? null,
          input.observations ?? null, input.assessment ?? null, input.followUp ?? null, input.internalNotes ?? null]
      );
      if (!rows[0]) throw new ApiRequestError(409, "NOTES_FINALIZED", "Finalized consultation notes cannot be changed.");
      response.json({ success: true, data: { notes: rows[0] }, meta: { requestId: response.locals.requestId } });
    } catch (error) { next(error); }
  });

  router.post("/:appointmentId/notes/finalize", requireAuthenticated(auth, cookieName), appointmentParams, async (_request, response, next) => {
    const client = await db.connect();
    try {
      const { appointmentId } = response.locals.validated.params as { appointmentId: string };
      const user = currentUser(response);
      if (user.role !== "Doctor") throw new ApiRequestError(403, "FORBIDDEN", "Only the assigned doctor can finalize consultation notes.");
      const row = await findConsultation(db, appointmentId);
      if (!row) throw new ApiRequestError(404, "CONSULTATION_NOT_FOUND", "Video consultation was not found.");
      if (!participant(row, user)) throw new ApiRequestError(403, "FORBIDDEN", "You are not assigned to this consultation.");
      if (!row.actual_ended_at) throw new ApiRequestError(409, "CONSULTATION_ACTIVE", "End the consultation before finalizing its summary.");
      await client.query("BEGIN");
      const draft = await client.query<{
        summary: string; assessment: string | null; record_id: string | null;
      }>(
        "SELECT summary,assessment,record_id FROM consultation_note_drafts WHERE appointment_id=$1 FOR UPDATE",
        [appointmentId]
      );
      if (!draft.rows[0]) throw new ApiRequestError(404, "NOTES_NOT_FOUND", "Save consultation notes before finalizing them.");
      if (draft.rows[0].record_id) {
        await client.query("COMMIT");
        response.json({ success: true, data: { recordId: draft.rows[0].record_id }, meta: { requestId: response.locals.requestId } });
        return;
      }
      const record = await client.query<{ id: string }>(
        `INSERT INTO consultation_records(patient_id,doctor_id,appointment_id,consultation_at,note,diagnosis)
         VALUES($1,$2,$3,COALESCE($4::timestamptz,now()),$5,$6) RETURNING id`,
        [row.patient_id, row.doctor_id, appointmentId, row.actual_started_at, draft.rows[0].summary, draft.rows[0].assessment]
      );
      const recordId = record.rows[0]!.id;
      await client.query(
        "UPDATE consultation_note_drafts SET record_id=$2,finalized_at=now(),finalized_by=$3,updated_at=now() WHERE appointment_id=$1",
        [appointmentId, recordId, user.id]
      );
      await client.query("COMMIT");
      response.status(201).json({ success: true, data: { recordId }, meta: { requestId: response.locals.requestId } });
    } catch (error) {
      await client.query("ROLLBACK");
      next(error);
    } finally { client.release(); }
  });

  return router;
}
