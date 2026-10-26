"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { EmptyCard, ErrorNotice, LoadingCard } from "../components/doctor-ui";
import { Notifications } from "../components/notifications";
import { DashboardNav } from "../components/dashboard-nav";
import { AppointmentDocuments } from "../components/appointment-documents";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
type Slot = { id?: string; startsAt: string; endsAt: string };
type Doctor = { id: string; givenName: string; familyName: string; specialization: string; qualification: string | null; experienceYears: number | null; bio: string | null; approvalStatus: "pending" | "approved" | "rejected" | "suspended"; availability: Slot[] };
type Appointment = { id: string; patientId: string; startsAt: string; endsAt: string; status: string; patientDisplayName: string; doctorDisplayName: string; specialization: string; type?: "in_person" | "video" };

async function errorMessage(response: Response) { const body = await response.json().catch(() => ({})); return body.error?.message ?? "Unable to complete the request."; }
export default function DoctorDashboard() {
  const [profile, setProfile] = useState<Doctor | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [slotStart, setSlotStart] = useState("");
  const [slotEnd, setSlotEnd] = useState("");
  const [slots, setSlots] = useState<Slot[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [appointmentsLoading, setAppointmentsLoading] = useState(true);
  const [appointmentsError, setAppointmentsError] = useState("");
  const [selectedPatientId, setSelectedPatientId] = useState("");
  const [patientRecords, setPatientRecords] = useState<Array<{ id: string; consultationAt: string; diagnosis: string | null; note: string }>>([]);
  const [patientRecordsLoading, setPatientRecordsLoading] = useState(false);
  const [recordError, setRecordError] = useState("");
  const [recordNotice, setRecordNotice] = useState("");

  const loadProfile = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch(`${apiUrl}/api/v1/doctors/me`, { credentials: "include" });
      if (!response.ok) throw new Error(await errorMessage(response));
      const body = await response.json();
      const current = body.data.profile as Doctor | null;
      setProfile(current); setSlots(current?.availability ?? []); setEditing(!body.data.complete);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load your profile."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void loadProfile(); }, [loadProfile]);

  const loadAppointments = useCallback(async () => {
    setAppointmentsLoading(true); setAppointmentsError("");
    try {
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
      const response = await fetch(`${apiUrl}/api/v1/appointments/doctor/me?timeZone=${encodeURIComponent(timeZone)}`, { credentials: "include" });
      if (!response.ok) throw new Error(await errorMessage(response));
      const body = await response.json(); setAppointments(body.data.appointments);
    } catch (cause) { setAppointmentsError(cause instanceof Error ? cause.message : "Unable to load your appointment queue."); }
    finally { setAppointmentsLoading(false); }
  }, []);
  useEffect(() => { void loadAppointments(); }, [loadAppointments]);

  useEffect(() => {
    if (!selectedPatientId) { setPatientRecords([]); setPatientRecordsLoading(false); return; }
    setRecordError(""); setRecordNotice(""); setPatientRecords([]); setPatientRecordsLoading(true);
    fetch(`${apiUrl}/api/v1/records/doctor?patientId=${encodeURIComponent(selectedPatientId)}`, { credentials: "include" })
      .then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error?.message ?? "Records are unavailable."); setPatientRecords(body.data.records); })
      .catch((cause) => setRecordError(cause instanceof Error ? cause.message : "Records are unavailable."))
      .finally(() => setPatientRecordsLoading(false));
  }, [selectedPatientId]);

  async function addConsultation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selectedPatientId) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      const response = await fetch(`${apiUrl}/api/v1/records/doctor`, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ patientId: selectedPatientId, diagnosis: form.get("diagnosis") || null, note: form.get("note") }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error?.message ?? "Record could not be saved.");
      setPatientRecords((current) => [body.data.record, ...current]); setRecordNotice("Consultation record saved."); formElement.reset();
    } catch (cause) { setRecordError(cause instanceof Error ? cause.message : "Record could not be saved."); }
  }

  async function updateAppointmentStatus(id: string, status: "confirmed" | "completed" | "no_show" | "cancelled") {
    setAppointmentsError("");
    try {
      const response = status === "cancelled"
        ? await fetch(`${apiUrl}/api/v1/appointments/${id}/cancel`, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason: "Cancelled by doctor" }) })
        : await fetch(`${apiUrl}/api/v1/appointments/${id}/status`, { method: "PATCH", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ status }) });
      if (!response.ok) throw new Error(await errorMessage(response));
      await loadAppointments();
    } catch (cause) { setAppointmentsError(cause instanceof Error ? cause.message : "Unable to update appointment."); }
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(""); setNotice("");
    const data = new FormData(event.currentTarget);
    const rawExperience = String(data.get("experienceYears") ?? "");
    const payload = {
      givenName: data.get("givenName"), familyName: data.get("familyName"), specialization: data.get("specialization"),
      qualification: data.get("qualification") || null,
      experienceYears: rawExperience ? Number(rawExperience) : null,
      bio: data.get("bio") || null
    };
    try {
      const response = await fetch(`${apiUrl}/api/v1/doctors/me`, { method: "PUT", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      if (!response.ok) throw new Error(await errorMessage(response));
      const body = await response.json(); setProfile(body.data.profile); setSlots(body.data.profile.availability ?? []); setEditing(false); setNotice("Profile saved. Approval status may change after a profile update.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to save your profile."); }
    finally { setSaving(false); }
  }

  function addSlot() {
    const start = new Date(slotStart); const end = new Date(slotEnd);
    if (!slotStart || !slotEnd || start <= new Date() || end <= start) { setError("Choose a future start and a later end time."); return; }
    if (slots.some((slot) => start < new Date(slot.endsAt) && end > new Date(slot.startsAt))) { setError("Availability periods cannot overlap."); return; }
    setSlots([...slots, { startsAt: start.toISOString(), endsAt: end.toISOString() }].sort((a, b) => a.startsAt.localeCompare(b.startsAt)));
    setSlotStart(""); setSlotEnd(""); setError("");
  }

  async function saveAvailability() {
    setSaving(true); setError(""); setNotice("");
    try {
      const response = await fetch(`${apiUrl}/api/v1/doctors/me/availability`, { method: "PUT", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ slots: slots.map(({ startsAt, endsAt }) => ({ startsAt, endsAt })) }) });
      if (!response.ok) throw new Error(await errorMessage(response));
      const body = await response.json(); setSlots(body.data.availability); setNotice("Availability saved.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to save availability."); }
    finally { setSaving(false); }
  }

  return <main className="patient-dashboard doctor-dashboard">
    <DashboardNav currentPath="/doctor" links={[{ href: "/doctor", label: "Overview" }, { href: "/doctor/messages", label: "Messages" }, { href: "/doctor/prescriptions", label: "Prescriptions" }, { href: "/doctor/ai-predictions", label: "AI predictions" }, { href: "/doctors", label: "Public directory" }]} />
    <Notifications />
    <header className="dashboard-heading"><div><p className="eyebrow">DOCTOR WORKSPACE</p><h1>Doctor dashboard</h1><p>Manage your professional profile and availability.</p></div><a className="secondary-button" href="/doctors">Doctor directory</a></header>
    {error && <ErrorNotice message={error} onRetry={() => void loadProfile()} />}
    {notice && <p className="notice notice-success" role="status">{notice}</p>}
    {loading ? <LoadingCard>Loading your profile…</LoadingCard> : <div className="dashboard-grid">
      <section className="dashboard-card profile-card">
        <div className="card-heading"><div><p className="eyebrow">PROFESSIONAL DETAILS</p><h2>Your doctor profile</h2></div>{profile && !editing && <button className="secondary-button" type="button" onClick={() => setEditing(true)}>Edit profile</button>}</div>
        {!profile && !editing && <EmptyCard title="Complete your doctor profile">Add your professional details before managing availability.</EmptyCard>}
        {profile && !editing && <><p className={`approval-badge approval-${profile.approvalStatus}`}>{profile.approvalStatus === "approved" ? "Approved · listed publicly" : `Approval ${profile.approvalStatus}`}</p><dl className="profile-details"><div><dt>Name</dt><dd>Dr. {profile.givenName} {profile.familyName}</dd></div><div><dt>Specialization</dt><dd>{profile.specialization}</dd></div><div><dt>Qualification</dt><dd>{profile.qualification || "Not provided"}</dd></div><div><dt>Experience</dt><dd>{profile.experienceYears === null ? "Not provided" : `${profile.experienceYears} years`}</dd></div></dl>{profile.bio && <p className="doctor-bio">{profile.bio}</p>}</>}
        {editing && <form className="profile-form" onSubmit={saveProfile}><div className="form-row"><label>First name<input name="givenName" required maxLength={80} defaultValue={profile?.givenName ?? ""} /></label><label>Last name<input name="familyName" required maxLength={80} defaultValue={profile?.familyName ?? ""} /></label></div><label>Specialization<input name="specialization" required minLength={2} maxLength={100} placeholder="e.g. Cardiology" defaultValue={profile?.specialization ?? ""} /></label><div className="form-row"><label>Qualification (optional)<input name="qualification" maxLength={160} defaultValue={profile?.qualification ?? ""} /></label><label>Years of experience (optional)<input name="experienceYears" type="number" min={0} max={60} step={1} defaultValue={profile?.experienceYears ?? ""} /></label></div><label>Professional bio (optional)<textarea name="bio" rows={4} maxLength={1200} defaultValue={profile?.bio ?? ""} /></label><div className="form-actions"><button className="primary-button" type="submit" disabled={saving}>{saving ? "Saving…" : "Save profile"}</button>{profile && <button className="secondary-button" type="button" onClick={() => setEditing(false)} disabled={saving}>Cancel</button>}</div></form>}
      </section>
      <section className="dashboard-card"><div className="card-heading"><div><p className="eyebrow">SCHEDULE</p><h2>Availability</h2></div></div>{!profile ? <EmptyCard title="Profile required">Complete your profile before adding availability.</EmptyCard> : <><div className="availability-form"><label>Starts<input type="datetime-local" value={slotStart} onChange={(event) => setSlotStart(event.target.value)} /></label><label>Ends<input type="datetime-local" value={slotEnd} onChange={(event) => setSlotEnd(event.target.value)} /></label><button className="secondary-button" type="button" onClick={addSlot}>Add time</button></div>{slots.length === 0 ? <EmptyCard title="No availability added">Add future time periods when patients may request appointments.</EmptyCard> : <ul className="availability-list">{slots.map((slot, index) => <li key={slot.id ?? `${slot.startsAt}-${index}`}><span>{new Date(slot.startsAt).toLocaleString()} – {new Date(slot.endsAt).toLocaleTimeString()}</span><button className="text-button" type="button" aria-label="Remove availability" onClick={() => setSlots(slots.filter((_, slotIndex) => slotIndex !== index))}>Remove</button></li>)}</ul>}<button className="primary-button" type="button" disabled={saving} onClick={() => void saveAvailability()}>{saving ? "Saving…" : "Save availability"}</button><p className="form-help">Saved future periods are published to patients when your profile is approved.</p></>}</section>
      <section className="dashboard-card doctor-appointments"><div className="card-heading"><div><p className="eyebrow">PATIENT CARE</p><h2>Appointments</h2></div><button type="button" className="text-button" onClick={() => void loadAppointments()}>Refresh</button></div>{appointmentsError && <ErrorNotice message={appointmentsError} onRetry={() => void loadAppointments()} />}{appointmentsLoading ? <LoadingCard>Loading appointment queue…</LoadingCard> : appointments.length === 0 ? <EmptyCard title="No appointments yet">Patient bookings assigned to you will appear here.</EmptyCard> : <ul className="appointment-list">{appointments.map((appointment) => <li key={appointment.id}><div><strong>{appointment.patientDisplayName}</strong><span>{new Date(appointment.startsAt).toLocaleString()}</span><span>{appointment.type === "video" ? "Video consultation" : "In person"}</span><em className={`status-pill status-${appointment.status}`}>{appointment.status.replace("_", " ")}</em></div>      <div className="appointment-actions">{appointment.type === "video" && ["booked", "confirmed"].includes(appointment.status) && <a className="secondary-button" href={`/consultation/${appointment.id}`}>Join video</a>}{["confirmed", "completed"].includes(appointment.status) && <a className="text-button" href="/doctor/messages">Message patient</a>}{appointment.status === "booked" && <button className="secondary-button" type="button" onClick={() => void updateAppointmentStatus(appointment.id, "confirmed")}>Confirm</button>}{appointment.status === "confirmed" && <><button className="secondary-button" type="button" onClick={() => void updateAppointmentStatus(appointment.id, "completed")}>Complete</button><button className="text-button" type="button" onClick={() => void updateAppointmentStatus(appointment.id, "no_show")}>No-show</button></>}{["booked", "confirmed"].includes(appointment.status) && <button className="text-button" type="button" onClick={() => void updateAppointmentStatus(appointment.id, "cancelled")}>Cancel</button>}</div></li>)}</ul>}</section>
      <section className="dashboard-card doctor-appointments"><div className="card-heading"><div><p className="eyebrow">CONSULTATIONS</p><h2>Patient health records</h2></div></div>{appointments.length === 0 ? <EmptyCard title="No care relationships yet">Records are available only for patients with an appointment assigned to you.</EmptyCard> : <><label className="record-patient-select">Patient<select value={selectedPatientId} onChange={(event) => setSelectedPatientId(event.target.value)}><option value="">Select a patient from your appointment queue</option>{[...new Map(appointments.map((appointment) => [appointment.patientId, appointment])).values()].map((appointment) => <option key={appointment.patientId} value={appointment.patientId}>{appointment.patientDisplayName}</option>)}</select></label>{recordError && <ErrorNotice message={recordError} />}{recordNotice && <p className="notice notice-success" role="status">{recordNotice}</p>}{selectedPatientId && <>{patientRecordsLoading ? <LoadingCard>Loading authorized records…</LoadingCard> : <><form className="profile-form consultation-form" onSubmit={addConsultation}><label>Diagnosis (optional)<textarea name="diagnosis" rows={2} maxLength={2000} /></label><label>Consultation note<textarea name="note" rows={5} required minLength={1} maxLength={10000} /></label><button className="primary-button" type="submit">Save consultation</button></form><h3>Authorized records</h3>{patientRecords.length === 0 ? <EmptyCard title="No records yet">Add a consultation record for this patient.</EmptyCard> : <ul className="record-summary-list">{patientRecords.map((record) => <li key={record.id}><strong>{record.diagnosis || "Consultation"}</strong><time>{new Date(record.consultationAt).toLocaleString()}</time><p>{record.note}</p></li>)}</ul>}</>}</>}</>}</section>
    </div>}
    {appointments.length > 0 && <section className="dashboard-card doctor-appointments"><p className="eyebrow">APPOINTMENT FILES</p><h2>Shared appointment documents</h2>{appointments.map((appointment) => <AppointmentDocuments key={appointment.id} appointmentId={appointment.id} />)}</section>}
  </main>;
}
