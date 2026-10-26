"use client";

import { useEffect, useState } from "react";
import { DashboardNav } from "../../components/dashboard-nav";
import { apiData } from "../../lib/api";

export default function DoctorAiPredictionsPage() {
  const [status, setStatus] = useState("Checking optional service…");
  useEffect(() => {
    apiData<{ configured: boolean; message: string }>("/api/v1/ai/status")
      .then((data) => setStatus(data.configured ? "An AI service is configured. Predictions still require an authorized patient association." : "No AI prediction service configured. No prediction history is available."))
      .catch((cause: unknown) => setStatus(cause instanceof Error ? cause.message : "AI service status could not be checked."));
  }, []);
  return <main className="patient-dashboard doctor-dashboard">
    <DashboardNav currentPath="/doctor/ai-predictions" links={[{ href: "/doctor", label: "Overview" }, { href: "/doctor/prescriptions", label: "Prescriptions" }, { href: "/doctor/ai-predictions", label: "AI predictions" }]} />
    <header className="dashboard-heading"><div><p className="eyebrow">DOCTOR WORKSPACE</p><h1>AI predictions</h1><p>Authorized patient AI results will appear here only after a real model integration is configured.</p></div></header>
    <section className="dashboard-card"><h2>Prediction history</h2><p role="status">{status}</p><p className="form-help">No results, confidence values, or interpretations are fabricated. Any future AI analysis requires professional review.</p></section>
  </main>;
}
