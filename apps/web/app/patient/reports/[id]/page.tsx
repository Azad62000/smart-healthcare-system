"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { DashboardNav } from "../../../components/dashboard-nav";
import { apiData } from "../../../lib/api";

type Report = { id: string; consultationAt: string; diagnosis: string | null; note: string; doctorDisplayName: string; specialization: string; appointmentId: string | null };

export default function PatientReportDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { setReport((await apiData<{ record: Report }>(`/api/v1/records/me/${encodeURIComponent(id)}`)).record); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Report could not be loaded."); }
    finally { setLoading(false); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);
  return <main className="patient-dashboard">
    <DashboardNav currentPath="/patient/reports" links={[{ href: "/patient", label: "Overview" }, { href: "/patient/reports", label: "Reports" }, { href: "/patient/records", label: "Health records" }]} />
    <header className="dashboard-heading"><div><p className="eyebrow">YOUR CARE</p><h1>Consultation report</h1><p>Private report for the authenticated patient account.</p></div><a className="secondary-button" href="/patient/reports">Back to reports</a></header>
    {error && <div className="notice notice-error" role="alert"><span>{error}</span><button className="text-button" type="button" onClick={() => void load()}>Retry</button></div>}
    {loading ? <section className="dashboard-card loading-card" role="status"><span className="spinner" />Loading report…</section>
      : report && <article className="dashboard-card report-detail"><div className="report-actions print-hidden"><button className="primary-button" type="button" onClick={() => window.print()}>Print report</button></div><p className="eyebrow">{report.specialization}</p><h2>{report.diagnosis || "Consultation"}</h2><p>{report.doctorDisplayName} · {new Date(report.consultationAt).toLocaleString()}</p>{report.diagnosis && <section><h3>Diagnosis</h3><p>{report.diagnosis}</p></section>}<section><h3>Consultation note</h3><p className="record-note">{report.note}</p></section><p className="form-help">This view displays a stored consultation record; it is not an independently generated clinical report.</p></article>}
  </main>;
}
