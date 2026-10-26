"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { DashboardNav } from "../../components/dashboard-nav";
import { apiData } from "../../lib/api";

type Appointment = { id: string; patientId: string; patientDisplayName: string; startsAt: string; status: string };
type Prescription = { id: string; medicationName: string; dosage: string; route: string; frequency: string; durationDays: number; issuedAt: string; doctorDisplayName: string };

export default function DoctorPrescriptionsPage() {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [selectedAppointment, setSelectedAppointment] = useState("");
  const [items, setItems] = useState<Prescription[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const selected = appointments.find(({ id }) => id === selectedAppointment);
  const loadAppointments = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const data = await apiData<{ appointments: Appointment[] }>("/api/v1/appointments/doctor/me");
      setAppointments(data.appointments.filter(({ status }) => status === "confirmed" || status === "completed"));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Assigned appointments could not be loaded."); }
    finally { setLoading(false); }
  }, []);
  const loadPrescriptions = useCallback(async (patientId: string) => {
    try { setItems((await apiData<{ prescriptions: Prescription[] }>(`/api/v1/prescriptions/doctor?patientId=${encodeURIComponent(patientId)}`)).prescriptions); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Prescriptions could not be loaded."); }
  }, []);
  useEffect(() => { void loadAppointments(); }, [loadAppointments]);
  useEffect(() => { setItems([]); setNotice(""); if (selected) void loadPrescriptions(selected.patientId); }, [selected?.patientId, loadPrescriptions]);
  async function createPrescription(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    setBusy(true); setError(""); setNotice("");
    const form = new FormData(event.currentTarget);
    const rawDuration = Number(form.get("durationDays"));
    try {
      await apiData("/api/v1/prescriptions/doctor", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          patientId: selected.patientId,
          appointmentId: selected.id,
          medicationName: form.get("medicationName"),
          dosage: form.get("dosage"),
          route: form.get("route"),
          frequency: form.get("frequency"),
          durationDays: rawDuration,
          instructions: form.get("instructions") || null
        })
      });
      setNotice("Prescription saved.");
      event.currentTarget.reset();
      await loadPrescriptions(selected.patientId);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Prescription could not be saved."); }
    finally { setBusy(false); }
  }
  return <main className="patient-dashboard doctor-dashboard">
    <DashboardNav currentPath="/doctor/prescriptions" links={[{ href: "/doctor", label: "Overview" }, { href: "/doctor/prescriptions", label: "Prescriptions" }, { href: "/doctor/ai-predictions", label: "AI predictions" }]} />
    <header className="dashboard-heading"><div><p className="eyebrow">DOCTOR WORKSPACE</p><h1>Prescriptions</h1><p>Create a prescription only for a patient on a confirmed or completed appointment.</p></div></header>
    {error && <p className="notice notice-error" role="alert">{error}</p>}
    {notice && <p className="notice notice-success" role="status">{notice}</p>}
    {loading ? <section className="dashboard-card loading-card" role="status"><span className="spinner" />Loading assigned appointments…</section>
      : <section className="dashboard-card"><label>Authorized appointment<select value={selectedAppointment} onChange={(event) => setSelectedAppointment(event.target.value)}><option value="">Choose an appointment</option>{appointments.map((appointment) => <option key={appointment.id} value={appointment.id}>{appointment.patientDisplayName} · {new Date(appointment.startsAt).toLocaleString()} · {appointment.status}</option>)}</select></label>
        {appointments.length === 0 && <p className="notification-empty">No confirmed or completed appointments are available for prescription entry.</p>}
        {selected && <><form className="profile-form prescription-form" onSubmit={(event) => void createPrescription(event)}><label>Medication name<input name="medicationName" required maxLength={200} /></label><div className="form-row"><label>Dosage<input name="dosage" required maxLength={120} /></label><label>Route<input name="route" required maxLength={80} placeholder="e.g. oral" /></label></div><div className="form-row"><label>Frequency<input name="frequency" required maxLength={120} /></label><label>Duration (days)<input type="number" name="durationDays" required min={1} max={3650} /></label></div><label>Instructions (optional)<textarea name="instructions" maxLength={2000} rows={3} /></label><button className="primary-button" type="submit" disabled={busy}>{busy ? "Saving…" : "Save prescription"}</button><p className="form-help">Prescriptions are clinician-entered. This application does not generate treatment recommendations.</p></form><h2>Prescription history for {selected.patientDisplayName}</h2>{items.length === 0 ? <p className="notification-empty">No prescriptions recorded for this patient.</p> : <ul>{items.map((item) => <li key={item.id}>{item.medicationName} · {item.dosage} · {item.frequency} · {new Date(item.issuedAt).toLocaleDateString()}</li>)}</ul>}</>}
      </section>}
  </main>;
}
