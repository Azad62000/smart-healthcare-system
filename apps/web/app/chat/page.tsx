import { DashboardNav } from "../components/dashboard-nav";

const suggestions = ["How do I book an appointment?", "Where can I find my health records?", "How can I contact my care team?"];

export default function HealthChatPage() {
  return <main className="patient-dashboard ai-workspace">
    <DashboardNav currentPath="/chat" links={[{ href: "/patient", label: "Overview" }, { href: "/patient/records", label: "Health records" }, { href: "/ai", label: "AI services" }, { href: "/chat", label: "Health chat" }]} />
    <header className="dashboard-heading"><div><p className="eyebrow">PATIENT SUPPORT</p><h1>Health assistant</h1><p>Find the right place in your care workspace.</p></div><span className="service-indicator"><i /> Assistant offline</span></header>
    <section className="assistant-panel dashboard-card" aria-labelledby="assistant-title"><div className="assistant-topline"><div className="assistant-avatar" aria-hidden="true">✳</div><div><h2 id="assistant-title">How can we help?</h2><p>Smart Healthcare assistant</p></div></div><div className="assistant-conversation"><div className="assistant-message"><p>The automated assistant is not available right now. These quick links can help you continue with your care.</p></div><div className="suggestion-list" aria-label="Suggested tasks">{suggestions.map((suggestion, index) => <a href={["/patient/appointments", "/patient/records", "/patient/appointments"][index]} key={suggestion}>{suggestion}<span aria-hidden="true">↗</span></a>)}</div></div><div className="assistant-composer"><label className="sr-only" htmlFor="assistant-input">Message</label><textarea id="assistant-input" rows={2} disabled placeholder="Assistant currently unavailable" aria-describedby="assistant-note" /><button type="button" className="primary-button" disabled aria-label="Send message">↑</button><p id="assistant-note">Messages are not sent or stored while the assistant is unavailable.</p></div></section>
    <p className="notice notice-info ai-disclaimer"><strong>Health information matters.</strong> This assistant is for general guidance only and does not replace care from a qualified clinician. Do not use it for urgent medical concerns.</p>
    <section className="care-contact-strip"><div><span aria-hidden="true">◉</span><div><strong>Need help with your care?</strong><p>Chat with your care team during a video consultation.</p></div></div><a className="secondary-button" href="/patient/appointments">View appointments</a></section>
  </main>;
}
