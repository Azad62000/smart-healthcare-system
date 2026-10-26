"use client";

import { useCallback, useEffect, useState } from "react";
import { DashboardNav } from "../../components/dashboard-nav";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
type RecordItem = { id: string; doctorDisplayName: string; specialization: string; appointmentId: string | null; consultationAt: string; note: string; diagnosis: string | null };

export default function PatientRecordsPage() {
  const [records, setRecords] = useState<RecordItem[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  const load = useCallback(async () => { setLoading(true); setError(""); try { const response = await fetch(`${apiUrl}/api/v1/records/me`, { credentials: "include" }); const body = await response.json(); if (!response.ok) throw new Error(body.error?.message ?? "Records could not be loaded."); setRecords(body.data.records); } catch (cause) { setError(cause instanceof Error ? cause.message : "Records could not be loaded."); } finally { setLoading(false); } }, []);
  useEffect(() => { void load(); }, [load]);
  return <main className="patient-dashboard"><DashboardNav currentPath="/patient/records" links={[{ href: "/patient", label: "Overview" }, { href: "/doctors", label: "Find a doctor" }, { href: "/patient/appointments", label: "Appointments" }, { href: "/patient/records", label: "Health records" }]} /><header className="dashboard-heading"><div><p className="eyebrow">YOUR RECORDS</p><h1>Health records</h1><p>Consultation records shared by your care team.</p></div><a className="secondary-button" href="/patient">Back to dashboard</a></header>{error && <div className="notice notice-error" role="alert"><span>{error}</span><button className="text-button" type="button" onClick={() => void load()}>Retry</button></div>}{loading ? <section className="dashboard-card loading-card" role="status"><span className="spinner" />Loading health records…</section> : records.length === 0 ? <section className="dashboard-card"><div className="empty-state compact"><h2>No health records yet</h2><p>Consultation notes from your care team will appear here.</p></div></section> : <div className="record-list">{records.map((record) => <article className="dashboard-card record-card" key={record.id}><header><div><p className="eyebrow">{record.specialization}</p><h2>{record.diagnosis || "Consultation"}</h2><p>{record.doctorDisplayName} · {new Date(record.consultationAt).toLocaleString()}</p></div></header>{record.diagnosis && <section><h3>Diagnosis</h3><p>{record.diagnosis}</p></section>}<section><h3>Consultation note</h3><p className="record-note">{record.note}</p></section></article>)}</div>}</main>;
}
