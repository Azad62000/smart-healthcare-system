"use client";

import { useEffect, useState } from "react";
import { LiveKitRoom, RoomAudioRenderer, StartAudio, VideoConference } from "@livekit/components-react";
import { useParams } from "next/navigation";
import { AppointmentDocuments } from "../../components/appointment-documents";

type Consultation = {
  appointmentId: string;
  patientDisplayName: string;
  doctorDisplayName: string;
  startsAt: string;
  endsAt: string;
  appointmentStatus: string;
  status: string;
  actualStartedAt: string | null;
  actualEndedAt: string | null;
};
type JoinData = { token: string; serverUrl: string; consultation: Consultation };
type ConsultationNotes = {
  summary: string; symptoms: string | null; observations: string | null;
  assessment: string | null; follow_up: string | null; internal_notes: string | null;
  finalized_at: string | null;
};
const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

async function readResponse(response: Response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error?.message ?? "Consultation request failed.");
  return body.data;
}

export default function ConsultationPage() {
  const params = useParams<{ appointmentId: string }>();
  const appointmentId = params.appointmentId;
  const [consultation, setConsultation] = useState<Consultation | null>(null);
  const [role, setRole] = useState<"Patient" | "Doctor" | "Admin" | "">("");
  const [join, setJoin] = useState<JoinData | null>(null);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [notes, setNotes] = useState<ConsultationNotes | null>(null);
  const [noteDraft, setNoteDraft] = useState({ summary: "", symptoms: "", observations: "", assessment: "", followUp: "", internalNotes: "" });
  const [notesBusy, setNotesBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [data, identity] = await Promise.all([
          readResponse(await fetch(`${apiUrl}/api/v1/teleconsultations/${appointmentId}`, { credentials: "include" })),
          readResponse(await fetch(`${apiUrl}/api/v1/auth/me`, { credentials: "include" }))
        ]);
        if (active) {
          setConsultation(data.consultation);
          setRole(identity.user.role);
          if (identity.user.role === "Doctor" || identity.user.role === "Patient") {
            const noteResponse = await fetch(`${apiUrl}/api/v1/teleconsultations/${appointmentId}/notes`, { credentials: "include" });
            if (noteResponse.ok) {
              const noteData = await readResponse(noteResponse);
              if (active) {
                setNotes(noteData.notes);
                setNoteDraft({
                  summary: noteData.notes.summary ?? "",
                  symptoms: noteData.notes.symptoms ?? "",
                  observations: noteData.notes.observations ?? "",
                  assessment: noteData.notes.assessment ?? "",
                  followUp: noteData.notes.follow_up ?? "",
                  internalNotes: noteData.notes.internal_notes ?? ""
                });
              }
            } else if (noteResponse.status !== 404) {
              const noteData = await noteResponse.json().catch(() => ({}));
              throw new Error(noteData.error?.message ?? "Consultation notes could not be loaded.");
            }
          }
        }
      } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : "Consultation details could not be loaded."); }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [appointmentId]);

  async function joinConsultation() {
    setBusy(true); setError(""); setNotice("");
    try {
      const data = await readResponse(await fetch(`${apiUrl}/api/v1/teleconsultations/${appointmentId}/token`, { method: "POST", credentials: "include" }));
      setJoin(data as JoinData);
      setConsultation((data as JoinData).consultation);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not join the video consultation."); }
    finally { setBusy(false); }
  }

  async function handleConnected() {
    setConnected(true);
    try {
      await readResponse(await fetch(`${apiUrl}/api/v1/teleconsultations/${appointmentId}/joined`, { method: "POST", credentials: "include" }));
      setNotice("Connected securely. Audio and video are not recorded.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Connection event could not be recorded."); }
  }

  async function endConsultation() {
    setBusy(true); setError("");
    try {
      await readResponse(await fetch(`${apiUrl}/api/v1/teleconsultations/${appointmentId}/end`, { method: "POST", credentials: "include" }));
      setJoin(null);
      setConsultation((current) => current ? { ...current, actualEndedAt: new Date().toISOString(), status: "completed" } : current);
      setNotice("Consultation ended.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not end the consultation."); }
    finally { setBusy(false); }
  }

  async function saveNotes() {
    setNotesBusy(true); setError("");
    try {
      const data = await readResponse(await fetch(`${apiUrl}/api/v1/teleconsultations/${appointmentId}/notes`, {
        method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(noteDraft)
      }));
      setNotes(data.notes);
      setNotice("Consultation notes saved as a draft.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save consultation notes."); }
    finally { setNotesBusy(false); }
  }

  async function finalizeNotes() {
    setNotesBusy(true); setError("");
    try {
      await readResponse(await fetch(`${apiUrl}/api/v1/teleconsultations/${appointmentId}/notes/finalize`, { method: "POST", credentials: "include" }));
      const data = await readResponse(await fetch(`${apiUrl}/api/v1/teleconsultations/${appointmentId}/notes`, { credentials: "include" }));
      setNotes(data.notes);
      setNotice("The consultation summary is finalized and visible to the patient.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not finalize the consultation summary."); }
    finally { setNotesBusy(false); }
  }

  if (loading) return <main className="patient-dashboard"><section className="dashboard-card loading-card" role="status">Loading consultation…</section></main>;
  return <main className="patient-dashboard">
    <a className="back-link" href="/">← Return to home</a>
    <header className="dashboard-heading"><div><p className="eyebrow">TELEMEDICINE</p><h1>Video consultation</h1><p>{consultation ? `${consultation.doctorDisplayName} · ${new Date(consultation.startsAt).toLocaleString()}` : "Appointment details unavailable"}</p></div></header>
    {error && <p className="notice notice-error" role="alert">{error}</p>}
    {notice && <p className="notice notice-success" role="status">{notice}</p>}
    {consultation && <>
      <section className="dashboard-card consultation-shell">
        <div className="consultation-video">
          {join && !consultation.actualEndedAt
            ? <LiveKitRoom token={join.token} serverUrl={join.serverUrl} connect audio video onConnected={() => void handleConnected()} onError={(cause) => setError(cause.message)}>
                <VideoConference />
                <RoomAudioRenderer />
                <StartAudio label="Enable audio" />
              </LiveKitRoom>
            : <div className="consultation-waiting"><h2>{consultation.actualEndedAt ? "Consultation ended" : "Video room"}</h2><p>{consultation.actualEndedAt ? "This consultation has ended." : "Join when your appointment is in its allowed time window. Camera and microphone permissions may be requested."}</p>{!consultation.actualEndedAt && <button className="primary-button" type="button" disabled={busy} onClick={() => void joinConsultation()}>{busy ? "Connecting…" : "Join video consultation"}</button>}</div>}
        </div>
        <aside className="consultation-side-panel">
          <h2>Consultation details</h2>
          <dl className="profile-details"><div><dt>Patient</dt><dd>{consultation.patientDisplayName}</dd></div><div><dt>Doctor</dt><dd>{consultation.doctorDisplayName}</dd></div><div><dt>Scheduled</dt><dd>{new Date(consultation.startsAt).toLocaleString()}</dd></div><div><dt>Status</dt><dd>{consultation.status.replace("_", " ")}</dd></div><div><dt>Started</dt><dd>{consultation.actualStartedAt ? new Date(consultation.actualStartedAt).toLocaleTimeString() : "Not started"}</dd></div></dl>
          <p className="form-help">Audio/video is not recorded. The service stores appointment and connection timing metadata only.</p>
          {connected && <button className="secondary-button" type="button" disabled={busy} onClick={() => void endConsultation()}>{busy ? "Ending…" : "End consultation"}</button>}
          {role === "Doctor" && <a href="/doctor/prescriptions">Prescription board</a>}
          {role === "Doctor" && <a href="/doctor/messages">Message patient</a>}
          {role === "Patient" && <a href="/patient/messages">Message care team</a>}
          {(role === "Doctor" || role === "Patient") && <section className="consultation-notes">
            <h2>{role === "Doctor" ? "Consultation notes" : "Doctor's summary"}</h2>
            {role === "Patient" && (notes?.finalized_at ? <>
              <p>{notes.summary}</p>
              {notes.symptoms && <p><strong>Symptoms:</strong> {notes.symptoms}</p>}
              {notes.observations && <p><strong>Observations:</strong> {notes.observations}</p>}
              {notes.assessment && <p><strong>Assessment:</strong> {notes.assessment}</p>}
              {notes.follow_up && <p><strong>Follow-up:</strong> {notes.follow_up}</p>}
            </> : <p>The doctor has not finalized a patient-visible summary.</p>)}
            {role === "Doctor" && <form className="form-stack" onSubmit={(event) => { event.preventDefault(); void saveNotes(); }}>
              <label>Summary<textarea required maxLength={10000} value={noteDraft.summary} onChange={(event) => setNoteDraft({ ...noteDraft, summary: event.target.value })} /></label>
              <label>Symptoms<textarea maxLength={5000} value={noteDraft.symptoms} onChange={(event) => setNoteDraft({ ...noteDraft, symptoms: event.target.value })} /></label>
              <label>Observations<textarea maxLength={5000} value={noteDraft.observations} onChange={(event) => setNoteDraft({ ...noteDraft, observations: event.target.value })} /></label>
              <label>Assessment<textarea maxLength={5000} value={noteDraft.assessment} onChange={(event) => setNoteDraft({ ...noteDraft, assessment: event.target.value })} /></label>
              <label>Follow-up<textarea maxLength={5000} value={noteDraft.followUp} onChange={(event) => setNoteDraft({ ...noteDraft, followUp: event.target.value })} /></label>
              <label>Internal notes (doctor only)<textarea maxLength={10000} value={noteDraft.internalNotes} onChange={(event) => setNoteDraft({ ...noteDraft, internalNotes: event.target.value })} /></label>
              <button className="secondary-button" type="submit" disabled={notesBusy || Boolean(notes?.finalized_at)}>{notesBusy ? "Saving…" : "Save draft"}</button>
              {consultation.actualEndedAt && <button className="primary-button" type="button" disabled={notesBusy || Boolean(notes?.finalized_at)} onClick={() => void finalizeNotes()}>{notesBusy ? "Finalizing…" : "Finalize and share summary"}</button>}
              {notes?.finalized_at && <p className="form-help">Finalized summaries cannot be edited.</p>}
            </form>}
          </section>}
          {(role === "Doctor" || role === "Patient") && <AppointmentDocuments appointmentId={appointmentId} />}
        </aside>
      </section>
    </>}
  </main>;
}
