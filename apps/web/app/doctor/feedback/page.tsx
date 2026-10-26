"use client";

import { useCallback, useEffect, useState } from "react";
import { DashboardNav } from "../../components/dashboard-nav";
import { EmptyCard, ErrorNotice, LoadingCard } from "../../components/doctor-ui";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
type DoctorFeedback = { id: string; appointmentId: string; rating: number; comment: string; createdAt: string; appointmentStartsAt: string };

export default function DoctorFeedbackPage() {
  const [items, setItems] = useState<DoctorFeedback[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch(`${apiUrl}/api/v1/feedback/doctor/me`, { credentials: "include" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Unable to load consultation feedback.");
      setItems(body.data.feedback);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load consultation feedback."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  return <main className="patient-dashboard">
    <DashboardNav currentPath="/doctor/feedback" links={[{ href: "/doctor", label: "Overview" }, { href: "/doctor/feedback", label: "Patient feedback" }, { href: "/doctor/messages", label: "Messages" }, { href: "/doctor/prescriptions", label: "Prescriptions" }, { href: "/doctor/ai-predictions", label: "AI predictions" }, { href: "/doctors", label: "Public directory" }]} />
    <header className="dashboard-heading"><div><p className="eyebrow">PRIVATE CLINICIAN INBOX</p><h1>Consultation feedback</h1><p>Comments are visible only to you as the doctor assigned to the appointment and to the patient who submitted them.</p></div><button type="button" className="secondary-button" onClick={() => void load()} disabled={loading}>Refresh</button></header>
    <section className="dashboard-card doctor-feedback-list" aria-label="Patient consultation feedback">
      {error ? <ErrorNotice message={error} onRetry={() => void load()} /> : loading ? <LoadingCard>Loading patient feedback…</LoadingCard> : items.length === 0 ? <EmptyCard title="No feedback yet">Feedback submitted after completed appointments assigned to you will appear here.</EmptyCard> : <ul>{items.map((item) => <li className="doctor-feedback-card" key={item.id}><div className="doctor-feedback-meta"><p className="feedback-stars-display" aria-label={`${item.rating} out of 5 stars`}>{"★".repeat(item.rating)}{"☆".repeat(5 - item.rating)} <strong>{item.rating}/5</strong></p><time dateTime={item.createdAt}>Received {new Date(item.createdAt).toLocaleString()}</time><span>Appointment {new Date(item.appointmentStartsAt).toLocaleString()}</span></div><p className="doctor-feedback-comment">{item.comment}</p></li>)}</ul>}
    </section>
  </main>;
}
