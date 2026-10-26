"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { Notifications } from "../components/notifications";
import { DashboardNav } from "../components/dashboard-nav";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
type Profile = { givenName: string; familyName: string; dateOfBirth: string; phone: string; addressLine: string | null; city: string | null; postalCode: string | null };
type ProfileResponse = { profile: Profile | null; complete: boolean };
type Appointment = { id: string; startsAt: string; endsAt: string; status: string; doctorDisplayName: string; specialization: string };
type HealthRecord = { id: string; doctorDisplayName: string; specialization: string; consultationAt: string; diagnosis: string | null; note: string };

async function readError(response: Response) {
  const body = await response.json().catch(() => ({}));
  return body.error?.message ?? "We could not complete that request. Please try again.";
}

export default function PatientDashboard() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [appointmentsLoading, setAppointmentsLoading] = useState(true);
  const [appointmentsError, setAppointmentsError] = useState("");
  const [records, setRecords] = useState<HealthRecord[]>([]);
  const [recordsLoading, setRecordsLoading] = useState(true);
  const [recordsError, setRecordsError] = useState("");

  const loadProfile = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`${apiUrl}/api/v1/patients/me`, { credentials: "include" });
      if (!response.ok) throw new Error(await readError(response));
      const body = await response.json() as { data: ProfileResponse };
      setProfile(body.data.profile);
      setEditing(!body.data.complete);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load your profile.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void loadProfile(); }, [loadProfile]);

  const loadAppointments = useCallback(async () => {
    setAppointmentsLoading(true); setAppointmentsError("");
    try {
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
      const response = await fetch(`${apiUrl}/api/v1/appointments/me?timeZone=${encodeURIComponent(timeZone)}`, { credentials: "include" });
      if (!response.ok) throw new Error(await readError(response));
      const body = await response.json(); setAppointments(body.data.appointments);
    } catch (cause) { setAppointmentsError(cause instanceof Error ? cause.message : "Could not load appointments."); }
    finally { setAppointmentsLoading(false); }
  }, []);
  useEffect(() => { void loadAppointments(); }, [loadAppointments]);

  const loadRecords = useCallback(async () => {
    setRecordsLoading(true); setRecordsError("");
    try {
      const response = await fetch(`${apiUrl}/api/v1/records/me`, { credentials: "include" });
      if (!response.ok) throw new Error(await readError(response));
      const body = await response.json(); setRecords(body.data.records);
    } catch (cause) { setRecordsError(cause instanceof Error ? cause.message : "Could not load health records."); }
    finally { setRecordsLoading(false); }
  }, []);
  useEffect(() => { void loadRecords(); }, [loadRecords]);

  async function cancelAppointment(id: string) {
    setAppointmentsError("");
    try {
      const response = await fetch(`${apiUrl}/api/v1/appointments/${id}/cancel`, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason: "Cancelled by patient" }) });
      if (!response.ok) throw new Error(await readError(response));
      await loadAppointments();
    } catch (cause) { setAppointmentsError(cause instanceof Error ? cause.message : "Could not cancel appointment."); }
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    const formData = new FormData(event.currentTarget);
    const payload = Object.fromEntries(formData.entries());
    try {
      const response = await fetch(`${apiUrl}/api/v1/patients/me`, {
        method: "PUT",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!response.ok) throw new Error(await readError(response));
      const body = await response.json() as { data: ProfileResponse };
      setProfile(body.data.profile);
      setEditing(false);
      setNotice("Your profile was saved.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save your profile.");
    } finally { setSaving(false); }
  }

  return <main className="patient-dashboard">
    <DashboardNav currentPath="/patient" links={[{ href: "/patient", label: "Overview" }, { href: "/doctors", label: "Find a doctor" }, { href: "/patient/appointments", label: "Appointments" }, { href: "/patient/messages", label: "Messages" }, { href: "/patient/records", label: "Health records" }, { href: "/patient/prescriptions", label: "Prescriptions" }, { href: "/patient/reports", label: "Reports" }, { href: "/ai", label: "AI services" }, { href: "/chat", label: "Health chat" }]} />
    <header className="dashboard-heading"><div><p className="eyebrow">PATIENT WORKSPACE</p><h1>Welcome{profile ? `, ${profile.givenName}` : ""}</h1><p>Manage your profile and find your care information.</p></div></header>
    {error && <div className="notice notice-error" role="alert"><span>{error}</span><button type="button" className="text-button" onClick={() => void loadProfile()}>Retry</button></div>}
    {notice && <p className="notice notice-success" role="status">{notice}</p>}
    <Notifications />
    {loading ? <section className="dashboard-card loading-card" aria-label="Loading patient profile"><span className="spinner" />Loading your profile…</section> : <div className="dashboard-grid">
      <section className="dashboard-card profile-card">
        <div className="card-heading"><div><p className="eyebrow">YOUR DETAILS</p><h2>Patient profile</h2></div>{profile && !editing && <button type="button" className="secondary-button" onClick={() => setEditing(true)}>Edit profile</button>}</div>
        {!profile && !editing && <div className="empty-state"><h3>Complete your profile</h3><p>Add a few details so your care team can identify and contact you.</p><button className="primary-button" type="button" onClick={() => setEditing(true)}>Complete profile</button></div>}
        {profile && !editing && <dl className="profile-details"><div><dt>Name</dt><dd>{profile.givenName} {profile.familyName}</dd></div><div><dt>Date of birth</dt><dd>{profile.dateOfBirth}</dd></div><div><dt>Phone</dt><dd>{profile.phone}</dd></div><div><dt>Address</dt><dd>{[profile.addressLine, profile.city, profile.postalCode].filter(Boolean).join(", ") || "Not provided"}</dd></div></dl>}
        {editing && <form className="profile-form" onSubmit={saveProfile}>
          <div className="form-row"><label>First name<input name="givenName" required minLength={1} maxLength={80} defaultValue={profile?.givenName ?? ""} autoComplete="given-name" /></label><label>Last name<input name="familyName" required minLength={1} maxLength={80} defaultValue={profile?.familyName ?? ""} autoComplete="family-name" /></label></div>
          <div className="form-row"><label>Date of birth<input name="dateOfBirth" type="date" required max={new Date().toISOString().slice(0, 10)} defaultValue={profile?.dateOfBirth ?? ""} /></label><label>Phone<input name="phone" type="tel" required minLength={7} maxLength={24} pattern="\+?[0-9 ()-]{7,24}" defaultValue={profile?.phone ?? ""} autoComplete="tel" /></label></div>
          <label>Address line (optional)<input name="addressLine" maxLength={160} defaultValue={profile?.addressLine ?? ""} autoComplete="street-address" /></label>
          <div className="form-row"><label>City (optional)<input name="city" maxLength={80} defaultValue={profile?.city ?? ""} autoComplete="address-level2" /></label><label>Postal code (optional)<input name="postalCode" maxLength={20} defaultValue={profile?.postalCode ?? ""} autoComplete="postal-code" /></label></div>
          <div className="form-actions"><button className="primary-button" type="submit" disabled={saving}>{saving ? "Saving…" : "Save profile"}</button>{profile && <button className="secondary-button" type="button" onClick={() => setEditing(false)} disabled={saving}>Cancel</button>}</div>
        </form>}
      </section>
      <section className="dashboard-card summary-card"><div className="card-heading"><div><p className="eyebrow">YOUR CARE</p><h2>Appointments</h2></div><span className="card-icon" aria-hidden="true">◷</span></div>{appointmentsError && <div className="notice notice-error" role="alert"><span>{appointmentsError}</span><button className="text-button" type="button" onClick={() => void loadAppointments()}>Retry</button></div>}{appointmentsLoading ? <div className="loading-card" role="status"><span className="spinner" />Loading appointments…</div> : appointments.length === 0 ? <div className="empty-state compact"><h3>No appointments yet</h3><p>Appointments you book will appear here.</p></div> : <ul className="appointment-list">{appointments.slice(0, 3).map((appointment) => <li key={appointment.id}><div><strong>{appointment.doctorDisplayName}</strong><span>{appointment.specialization}</span><time dateTime={appointment.startsAt}>{new Date(appointment.startsAt).toLocaleString()}</time><em className={`status-pill status-${appointment.status}`}>{appointment.status.replace("_", " ")}</em></div>{["booked", "confirmed"].includes(appointment.status) && new Date(appointment.startsAt) > new Date() && <button aria-label={`Cancel appointment with ${appointment.doctorDisplayName}`} className="text-button" type="button" onClick={() => void cancelAppointment(appointment.id)}>Cancel</button>}</li>)}</ul>}<a className="card-link" href="/patient/appointments">View appointment history <span aria-hidden="true">→</span></a></section>
      <section className="dashboard-card summary-card"><div className="card-heading"><div><p className="eyebrow">YOUR RECORDS</p><h2>Health records</h2></div><span className="card-icon" aria-hidden="true">＋</span></div>{recordsError && <div className="notice notice-error" role="alert"><span>{recordsError}</span><button className="text-button" type="button" onClick={() => void loadRecords()}>Retry</button></div>}{recordsLoading ? <div className="loading-card" role="status"><span className="spinner" />Loading records…</div> : records.length === 0 ? <div className="empty-state compact"><h3>No health records yet</h3><p>Consultation records from your care team will appear here.</p></div> : <ul className="appointment-list">{records.slice(0, 3).map((record) => <li key={record.id}><div><strong>{record.diagnosis || "Consultation"}</strong><span>{record.doctorDisplayName} · {record.specialization}</span><time dateTime={record.consultationAt}>{new Date(record.consultationAt).toLocaleDateString()}</time></div></li>)}</ul>}<a className="card-link" href="/patient/records">View health records <span aria-hidden="true">→</span></a></section>
    </div>}
  </main>;
}
