import { DashboardNav } from "../components/dashboard-nav";
import { HealthAssistant } from "../components/health-assistant";

export default function HealthChatPage() {
  return <main className="patient-dashboard ai-workspace">
    <DashboardNav currentPath="/chat" links={[{ href: "/patient", label: "Overview" }, { href: "/patient/records", label: "Health records" }, { href: "/ai", label: "AI services" }, { href: "/chat", label: "Health chat" }]} />
    <header className="dashboard-heading"><div><p className="eyebrow">PATIENT SUPPORT</p><h1>Health assistant</h1><p>Ask general health questions with Google Gemini.</p></div></header>
    <HealthAssistant />
    <p className="notice notice-info ai-disclaimer"><strong>Health information matters.</strong> Gemini can make mistakes and is not a diagnosis or a replacement for a qualified clinician. Do not use it for urgent medical concerns.</p>
    <section className="care-contact-strip"><div><span aria-hidden="true">◉</span><div><strong>Need help with your care?</strong><p>Chat with your care team during a video consultation.</p></div></div><a className="secondary-button" href="/patient/appointments">View appointments</a></section>
  </main>;
}
