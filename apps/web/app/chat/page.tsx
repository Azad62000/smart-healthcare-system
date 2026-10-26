"use client";

import { FormEvent, useState } from "react";
import { DashboardNav } from "../components/dashboard-nav";
import { apiData } from "../lib/api";

export default function HealthChatPage() {
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setStatus("");
    try {
      await apiData("/api/v1/chat/messages", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message }) });
      setStatus("No chatbot response is available.");
    } catch (cause) { setStatus(cause instanceof Error ? cause.message : "Chat service is unavailable."); }
    finally { setBusy(false); }
  }
  return <main className="patient-dashboard">
    <DashboardNav currentPath="/chat" links={[{ href: "/patient", label: "Overview" }, { href: "/patient/records", label: "Health records" }, { href: "/ai", label: "AI services" }, { href: "/chat", label: "Health chat" }]} />
    <header className="dashboard-heading"><div><p className="eyebrow">OPTIONAL INTEGRATION</p><h1>Health chat</h1><p>Secure chatbot conversations are not enabled for this application.</p></div></header>
    <section className="dashboard-card"><p className="notice notice-info" role="status">No chatbot service is configured. Messages are not sent or stored, and this page does not provide medical advice.</p><div className="chat-empty"><h2>Chat unavailable</h2><p>A chat provider must be configured before a conversation can start.</p></div><form className="profile-form" onSubmit={(event) => void submit(event)}><label htmlFor="chat-message">Message</label><textarea id="chat-message" value={message} onChange={(event) => setMessage(event.target.value)} maxLength={4000} required rows={3} /><button className="primary-button" type="submit" disabled={busy || !message.trim()}>{busy ? "Checking…" : "Check chat availability"}</button></form>{status && <p role="alert" className="notice notice-error">{status}</p>}</section>
  </main>;
}
