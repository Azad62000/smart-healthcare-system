"use client";

import { useCallback, useEffect, useState } from "react";
import { DashboardNav } from "../../components/dashboard-nav";
import { apiData } from "../../lib/api";

type Report = { id: string; consultationAt: string; diagnosis: string | null; doctorDisplayName: string; specialization: string; appointmentId: string | null };

export default function PatientReportsPage() {
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { setReports((await apiData<{ records: Report[] }>("/api/v1/records/me")).records); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Reports could not be loaded."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  return <main className="patient-dashboard">
    <DashboardNav currentPath="/patient/reports" links={[{ href: "/patient", label: "Overview" }, { href: "/doctors", label: "Find a doctor" }, { href: "/patient/appointments", label: "Appointments" }, { href: "/patient/records", label: "Health records" }, { href: "/patient/prescriptions", label: "Prescriptions" }, { href: "/patient/reports", label: "Reports" }, { href: "/ai", label: "AI services" }, { href: "/chat", label: "Health chat" }]} />
    <header className="dashboard-heading"><div><p className="eyebrow">YOUR CARE</p><h1>Reports</h1><p>Consultation reports based on records stored for your account.</p></div></header>
    {error && <div className="notice notice-error" role="alert"><span>{error}</span><button type="button" className="text-button" onClick={() => void load()}>Retry</button></div>}
    {loading ? <section className="dashboard-card loading-card" role="status"><span className="spinner" />Loading reports…</section>
      : reports.length === 0 ? <section className="dashboard-card"><div className="empty-state"><h2>No reports available</h2><p>Reports are created from consultation records shared with your account. No documents are configured for download.</p></div></section>
        : <div className="record-list">{reports.map((report) => <article className="dashboard-card report-card" key={report.id}><div><p className="eyebrow">{report.specialization} · Consultation report</p><h2>{report.diagnosis || "Consultation"}</h2><p>{report.doctorDisplayName} · {new Date(report.consultationAt).toLocaleDateString()}</p></div><div className="report-actions"><a className="secondary-button" href={`/patient/reports/${report.id}`}>View report</a><button className="text-button" type="button" onClick={() => window.print()}>Print report list</button></div></article>)}</div>}
  </main>;
}
