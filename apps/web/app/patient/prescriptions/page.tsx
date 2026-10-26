"use client";

import { useCallback, useEffect, useState } from "react";
import { DashboardNav } from "../../components/dashboard-nav";
import { apiData } from "../../lib/api";

type Prescription = { id: string; medicationName: string; dosage: string; route: string; frequency: string; durationDays: number; instructions: string | null; status: string; issuedAt: string; doctorDisplayName: string };

export default function PatientPrescriptionsPage() {
  const [items, setItems] = useState<Prescription[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { setItems((await apiData<{ prescriptions: Prescription[] }>("/api/v1/prescriptions/me")).prescriptions); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Prescriptions could not be loaded."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  return <main className="patient-dashboard">
    <DashboardNav currentPath="/patient/prescriptions" links={[{ href: "/patient", label: "Overview" }, { href: "/doctors", label: "Find a doctor" }, { href: "/patient/appointments", label: "Appointments" }, { href: "/patient/records", label: "Health records" }, { href: "/patient/prescriptions", label: "Prescriptions" }, { href: "/ai", label: "AI services" }, { href: "/chat", label: "Health chat" }]} />
    <header className="dashboard-heading"><div><p className="eyebrow">YOUR CARE</p><h1>Prescriptions</h1><p>Prescriptions issued by a doctor for your confirmed care relationship.</p></div></header>
    {error && <div className="notice notice-error" role="alert"><span>{error}</span><button className="text-button" type="button" onClick={() => void load()}>Retry</button></div>}
    {loading ? <section className="dashboard-card loading-card" role="status"><span className="spinner" />Loading prescriptions…</section>
      : items.length === 0 ? <section className="dashboard-card"><div className="empty-state"><h2>No prescriptions available</h2><p>Prescriptions from your care team will appear here.</p></div></section>
        : <div className="record-list">{items.map((item) => <article className="dashboard-card record-card" key={item.id}><header><div><p className="eyebrow">{item.status}</p><h2>{item.medicationName}</h2><p>Issued by {item.doctorDisplayName} · {new Date(item.issuedAt).toLocaleDateString()}</p></div></header><dl className="profile-details"><div><dt>Dosage</dt><dd>{item.dosage}</dd></div><div><dt>Route</dt><dd>{item.route}</dd></div><div><dt>Frequency</dt><dd>{item.frequency}</dd></div><div><dt>Duration</dt><dd>{item.durationDays} days</dd></div></dl>{item.instructions && <p>{item.instructions}</p>}</article>)}</div>}
  </main>;
}
