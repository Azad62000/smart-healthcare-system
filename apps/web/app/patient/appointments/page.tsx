"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { DashboardNav } from "../../components/dashboard-nav";
import { AppointmentDocuments } from "../../components/appointment-documents";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
type Doctor = { id: string; givenName: string; familyName: string; specialization: string; city?: string | null; state?: string | null; consultationModes?: Array<"in_person" | "video">; consultationFeeInr?: number | null; isSynthetic?: boolean };
type Slot = { startsAt: string; endsAt: string };
type Appointment = { id: string; doctorDisplayName: string; specialization: string; startsAt: string; endsAt: string; status: string; type?: "in_person" | "video"; doctorIsSynthetic?: boolean };
type DoctorRecommendation = { doctor: Doctor; earliestAvailableSlot: Slot; reasons: string[] };
type PatientFeedback = { id: string; appointmentId: string; rating: number; comment: string; createdAt: string };
function timeZone() { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; }
async function responseData(response: Response) { const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(body.error?.message ?? "Appointment request failed."); return body.data; }

export default function PatientAppointmentsPage() {
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [doctorId, setDoctorId] = useState("");
  const [slots, setSlots] = useState<Slot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [selected, setSelected] = useState("");
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [feedback, setFeedback] = useState<PatientFeedback[]>([]);
  const [feedbackDrafts, setFeedbackDrafts] = useState<Record<string, { rating: number; comment: string }>>({});
  const [feedbackBusy, setFeedbackBusy] = useState("");
  const [feedbackError, setFeedbackError] = useState("");
  const [feedbackNotice, setFeedbackNotice] = useState("");
  const [historyFilter, setHistoryFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [recommendationSpecialization, setRecommendationSpecialization] = useState("");
  const [recommendationCity, setRecommendationCity] = useState("");
  const [recommendationMode, setRecommendationMode] = useState<"in_person" | "video" | "">("");
  const [recommendationMaxFee, setRecommendationMaxFee] = useState("");
  const [appointmentType, setAppointmentType] = useState<"in_person" | "video">("in_person");
  const [recommendations, setRecommendations] = useState<DoctorRecommendation[]>([]);
  const [recommendationsEnabled, setRecommendationsEnabled] = useState<boolean | null>(null);
  const [recommendationsLoading, setRecommendationsLoading] = useState(false);
  const [recommendationError, setRecommendationError] = useState("");
  const from = new Date(); const to = new Date(Date.now() + 30 * 86400_000);
  const queryWindow = `from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}&timeZone=${encodeURIComponent(timeZone())}`;

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [directory, history] = await Promise.all([
        fetch(`${apiUrl}/api/v1/doctors/directory`),
        fetch(`${apiUrl}/api/v1/appointments/me?timeZone=${encodeURIComponent(timeZone())}`, { credentials: "include" })
      ]);
      const [directoryData, appointmentData] = await Promise.all([responseData(directory), responseData(history)]);
      setDoctors(directoryData.doctors); setAppointments(appointmentData.appointments);
      try {
        const feedbackData = await responseData(await fetch(`${apiUrl}/api/v1/feedback/me`, { credentials: "include" }));
        setFeedback(feedbackData.feedback);
        setFeedbackError("");
      } catch (cause) { setFeedbackError(cause instanceof Error ? cause.message : "Feedback could not be loaded."); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load appointment details."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function loadSlots(id: string, clearError = true, type = appointmentType) {
    setDoctorId(id); setSlots([]); setSelected(""); if (clearError) setError("");
    if (!id) { setSlotsLoading(false); return; }
    setSlotsLoading(true);
    try {
      const data = await responseData(await fetch(`${apiUrl}/api/v1/appointments/available-slots?doctorId=${encodeURIComponent(id)}&${queryWindow}&type=${type}`));
      setSlots(data.slots);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load available slots."); }
    finally { setSlotsLoading(false); }
  }

  async function loadRecommendations() {
    setRecommendationsLoading(true); setRecommendationError("");
    const preference = recommendationSpecialization.trim();
    const query = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
    if (preference) query.set("specialization", preference);
    if (recommendationCity.trim()) query.set("city", recommendationCity.trim());
    if (recommendationMode) query.set("mode", recommendationMode);
    if (recommendationMaxFee) query.set("maxFee", recommendationMaxFee);
    try {
      const data = await responseData(await fetch(`${apiUrl}/api/v1/doctors/recommendations?${query}`, { credentials: "include" }));
      setRecommendationsEnabled(data.enabled);
      setRecommendations(data.recommendations ?? []);
    } catch (cause) { setRecommendationError(cause instanceof Error ? cause.message : "Unable to load doctor recommendations."); }
    finally { setRecommendationsLoading(false); }
  }

  async function book(event: FormEvent) {
    event.preventDefault(); if (!selected) return;
    const slot = slots.find((item) => item.startsAt === selected); if (!slot) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await responseData(await fetch(`${apiUrl}/api/v1/appointments`, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ doctorId, startsAt: slot.startsAt, endsAt: slot.endsAt, type: appointmentType }) }));
      setNotice("Appointment booked."); setSelected(""); await load(); await loadSlots(doctorId);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to book this appointment."); await loadSlots(doctorId, false); }
    finally { setBusy(false); }
  }

  async function cancel(id: string) {
    try { await responseData(await fetch(`${apiUrl}/api/v1/appointments/${id}/cancel`, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason: "Cancelled by patient" }) })); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to cancel appointment."); }
  }
  async function submitFeedback(event: FormEvent<HTMLFormElement>, appointmentId: string) {
    event.preventDefault();
    const draft = feedbackDrafts[appointmentId];
    if (!draft || draft.rating < 1 || !draft.comment.trim()) return;
    setFeedbackBusy(appointmentId); setFeedbackError(""); setFeedbackNotice("");
    try {
      const data = await responseData(await fetch(`${apiUrl}/api/v1/feedback/appointments/${encodeURIComponent(appointmentId)}`, {
        method: "POST", credentials: "include", headers: { "content-type": "application/json" },
        body: JSON.stringify({ rating: draft.rating, comment: draft.comment.trim() })
      }));
      setFeedback((current) => [...current, data.feedback]);
      setFeedbackNotice("Thank you. Your feedback was saved to your private history.");
    } catch (cause) { setFeedbackError(cause instanceof Error ? cause.message : "Feedback could not be submitted."); }
    finally { setFeedbackBusy(""); }
  }
  const filteredAppointments = appointments.filter((appointment) => historyFilter === "all" || appointment.status === historyFilter);

  return <main className="patient-dashboard">
    <DashboardNav currentPath="/patient/appointments" links={[{ href: "/patient", label: "Overview" }, { href: "/doctors", label: "Find a doctor" }, { href: "/patient/appointments", label: "Appointments" }, { href: "/patient/messages", label: "Messages" }, { href: "/patient/records", label: "Health records" }, { href: "/patient/prescriptions", label: "Prescriptions" }, { href: "/patient/reports", label: "Reports" }, { href: "/ai", label: "AI services" }, { href: "/chat", label: "Health chat" }]} />
    <header className="dashboard-heading"><div><p className="eyebrow">YOUR CARE</p><h1>Appointments</h1><p>Choose an approved doctor and a published available time.</p></div></header>
    {error && <div className="notice notice-error" role="alert"><span>{error}</span><button className="text-button" onClick={() => void load()} type="button">Retry</button></div>}
    {notice && <p className="notice notice-success" role="status">{notice}</p>}
    {loading ? <section className="dashboard-card loading-card" role="status"><span className="spinner" />Loading appointments…</section> : <div className="appointments-layout">
      <section className="dashboard-card" id="booking">
        <p className="eyebrow">BOOK A VISIT</p><h2>Find an available time</h2>
        <div className="recommendation-panel" id="recommendations">
          <h3>Optional doctor recommendations</h3>
          <p>Filter by your preferences and available time. These suggestions are not a clinical suitability assessment.</p>
          <label>Specialization preference (optional)<input value={recommendationSpecialization} onChange={(event) => setRecommendationSpecialization(event.target.value)} maxLength={100} placeholder="e.g. Cardiology" /></label>
          <label>City preference (optional)<input value={recommendationCity} onChange={(event) => setRecommendationCity(event.target.value)} maxLength={100} placeholder="e.g. Pune" /></label>
          <label>Consultation mode (optional)<select value={recommendationMode} onChange={(event) => setRecommendationMode(event.target.value as "in_person" | "video" | "")}><option value="">Any mode</option><option value="in_person">In person</option><option value="video">Video</option></select></label>
          <label>Maximum fee in INR (optional)<input type="number" min={0} max={1000000} step={1} value={recommendationMaxFee} onChange={(event) => setRecommendationMaxFee(event.target.value)} /></label>
          <button className="secondary-button" type="button" onClick={() => void loadRecommendations()} disabled={recommendationsLoading}>{recommendationsLoading ? "Finding doctors…" : "Find doctors"}</button>
          {recommendationError && <p className="notice notice-error" role="alert">{recommendationError}</p>}
          {recommendationsEnabled === false && <p className="form-help" role="status">Recommendations are not enabled. You can still browse the approved doctor directory and book below.</p>}
          {recommendationsEnabled && recommendations.length === 0 && <p className="form-help" role="status">No doctors with matching preferences and available times were found. Broaden your filters or browse the directory.</p>}
          {recommendations.length > 0 && <ul className="recommendation-list">{recommendations.map((item) => <li key={item.doctor.id}>
            <strong>Dr. {item.doctor.givenName} {item.doctor.familyName} · {item.doctor.specialization}</strong>
            {item.doctor.isSynthetic && <em className="synthetic-label">Fictional clinician · not for real care</em>}
            {item.doctor.city && <span>{item.doctor.city}{item.doctor.state ? `, ${item.doctor.state}` : ""}</span>}
            {item.doctor.consultationFeeInr !== null && item.doctor.consultationFeeInr !== undefined && <span>Illustrative fee: INR {item.doctor.consultationFeeInr}</span>}
            <time dateTime={item.earliestAvailableSlot.startsAt}>Earliest: {new Date(item.earliestAvailableSlot.startsAt).toLocaleString()} ({timeZone()})</time>
            <ul>{item.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
            <button className="text-button" type="button" onClick={() => {
              const type = recommendationMode || item.doctor.consultationModes?.[0] || "in_person";
              setAppointmentType(type);
              void loadSlots(item.doctor.id, true, type);
            }}>Choose this doctor</button>
          </li>)}</ul>}
        </div>
        <form className="booking-form" onSubmit={book}>
          <label>Consultation mode<select value={appointmentType} onChange={(event) => {
            const type = event.target.value === "video" ? "video" : "in_person";
            setAppointmentType(type);
            if (doctorId) void loadSlots(doctorId, true, type);
          }}><option value="in_person">In person</option><option value="video">Video</option></select></label>
          <label>Approved doctor<select value={doctorId} onChange={(event) => void loadSlots(event.target.value)} required><option value="">Select a doctor</option>{doctors.map((doctor) => <option key={doctor.id} value={doctor.id}>Dr. {doctor.givenName} {doctor.familyName} · {doctor.specialization}{doctor.isSynthetic ? " · Fictional clinician" : ""}</option>)}</select></label>
          {doctorId && !slotsLoading && <label>Available time<select value={selected} onChange={(event) => setSelected(event.target.value)} required><option value="">Select a time</option>{slots.map((slot) => <option key={slot.startsAt} value={slot.startsAt}>{new Date(slot.startsAt).toLocaleString()} ({timeZone()})</option>)}</select></label>}
          {slotsLoading && <p role="status" className="form-help">Loading available times…</p>}
          {doctorId && !slotsLoading && slots.length === 0 && <p className="form-help">No published slots available for this mode in the next 30 days.</p>}
          <button className="primary-button" type="submit" disabled={busy || slotsLoading || !selected}>{busy ? "Booking…" : "Book appointment"}</button>
          <p className="form-help">Times are displayed in your browser time zone ({timeZone()}); the API stores UTC timestamps.</p>
        </form>
      </section>
      <section className="dashboard-card appointment-history-card" id="history"><div className="section-heading"><div><p className="eyebrow">YOUR CARE JOURNEY</p><h2>Your appointments</h2></div><label className="history-filter">Filter<select aria-label="Filter appointments by status" value={historyFilter} onChange={(event) => setHistoryFilter(event.target.value)}><option value="all">All visits</option>{[...new Set(appointments.map((appointment) => appointment.status))].sort().map((status) => <option key={status} value={status}>{status.replace("_", " ")}</option>)}</select></label></div>
        {feedbackError && <p className="notice notice-error" role="alert">{feedbackError}</p>}{feedbackNotice && <p className="notice notice-success" role="status">{feedbackNotice}</p>}
        {appointments.length === 0 ? <div className="empty-state compact"><h3>No appointments yet</h3><p>Your bookings will appear here.</p></div> : filteredAppointments.length === 0 ? <div className="empty-state compact"><h3>No matching visits</h3><p>Choose another status to see more appointments.</p></div> :
          <ul className="appointment-list">{filteredAppointments.map((appointment) => <li key={appointment.id}>
            <div><strong>{appointment.doctorDisplayName}{appointment.doctorIsSynthetic ? " · Fictional clinician" : ""}</strong><span>{appointment.specialization}</span><time dateTime={appointment.startsAt}>{new Date(appointment.startsAt).toLocaleString()} ({timeZone()})</time><span>{appointment.type === "video" ? "Video consultation" : "In person"}</span><em className={`status-pill status-${appointment.status}`}>{appointment.status.replace("_", " ")}</em></div>
            <div>{appointment.type === "video" && ["booked", "confirmed"].includes(appointment.status) && <a className="text-button" href={`/consultation/${appointment.id}`}>Join video visit</a>}{["confirmed", "completed"].includes(appointment.status) && <a className="text-button" href="/patient/messages">Message care team</a>}{["booked", "confirmed"].includes(appointment.status) && new Date(appointment.startsAt) > new Date() && <button aria-label={`Cancel appointment with ${appointment.doctorDisplayName}`} className="text-button" type="button" onClick={() => void cancel(appointment.id)}>Cancel</button>}</div>
            {appointment.status === "completed" && (() => {
              const submitted = feedback.find((item) => item.appointmentId === appointment.id);
              const draft = feedbackDrafts[appointment.id] ?? { rating: 0, comment: "" };
              return submitted ? <div className="appointment-feedback submitted-feedback"><p className="eyebrow">YOUR FEEDBACK</p><p className="feedback-stars-display" aria-label={`${submitted.rating} out of 5 stars`}>{"★".repeat(submitted.rating)}{"☆".repeat(5 - submitted.rating)} <strong>{submitted.rating}/5</strong></p><p>{submitted.comment}</p><small>Saved to your private history. Only aggregate star ratings appear on doctor profiles.</small></div> : <form className="appointment-feedback" aria-label={`Feedback for ${appointment.doctorDisplayName}`} onSubmit={(event) => void submitFeedback(event, appointment.id)}><p className="eyebrow">HOW WAS YOUR CONSULTATION?</p><fieldset className="feedback-rating"><legend>Choose a star rating</legend>{[1, 2, 3, 4, 5].map((rating) => <label className={draft.rating >= rating ? "is-selected" : ""} key={rating}><input type="radio" name={`rating-${appointment.id}`} value={rating} aria-label={`${rating} ${rating === 1 ? "star" : "stars"}`} required checked={draft.rating === rating} onChange={() => setFeedbackDrafts((current) => ({ ...current, [appointment.id]: { ...draft, rating } }))} /><span aria-hidden="true">★</span><span className="sr-only">{rating} {rating === 1 ? "star" : "stars"}</span></label>)}</fieldset><label className="feedback-comment-label">Comment<textarea value={draft.comment} maxLength={2000} required rows={3} placeholder="Share feedback about the consultation" onChange={(event) => setFeedbackDrafts((current) => ({ ...current, [appointment.id]: { ...draft, comment: event.target.value } }))} /></label><button className="secondary-button" type="submit" disabled={feedbackBusy === appointment.id || !draft.rating || !draft.comment.trim()}>{feedbackBusy === appointment.id ? "Sending…" : "Send private feedback"}</button><small>Visible only to you. Only aggregated star ratings appear on doctor profiles.</small></form>;
            })()}
            <AppointmentDocuments appointmentId={appointment.id} />
          </li>)}</ul>}
      </section>
    </div>}
  </main>;
}
