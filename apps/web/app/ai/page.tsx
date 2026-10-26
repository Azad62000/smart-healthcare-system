import { DashboardNav } from "../components/dashboard-nav";

const services = [
  ["heart-risk", "Heart health", "Risk assessment", "No model is connected. No health information is collected here.", "Unavailable"],
  ["diabetes-risk", "Diabetes", "Risk assessment", "No model is connected. No health information is collected here.", "Unavailable"],
  ["symptom-checker", "Symptoms", "Health guidance", "This application does not assess symptoms or provide triage.", "Unavailable"],
  ["medical-image", "Medical images", "Image analysis", "Secure image storage and an approved analysis service are not configured.", "Unavailable"],
  ["medication-interactions", "Medicine safety", "Interaction checking", "No medication reference database or checker is connected.", "Unavailable"],
  ["health-trends", "Health trends", "Longitudinal view", "No health trend analysis service is connected.", "Unavailable"]
];

export default function AiServicesPage() {
  return <main className="patient-dashboard ai-workspace">
    <DashboardNav currentPath="/ai" links={[{ href: "/patient", label: "Overview" }, { href: "/patient/appointments", label: "Appointments" }, { href: "/patient/records", label: "Health records" }, { href: "/ai", label: "AI services" }, { href: "/chat", label: "Health chat" }]} />
    <header className="dashboard-heading ai-heading"><div><p className="eyebrow">CARE TECHNOLOGY</p><h1>Health guidance</h1><p>Explore the digital services available in your care workspace.</p></div><span className="service-indicator"><i /> AI services unavailable</span></header>
    <section className="ai-welcome dashboard-card"><div className="ai-orb" aria-hidden="true"><span>✳</span></div><div><p className="eyebrow">A CLEAR VIEW OF WHAT’S AVAILABLE</p><h2>Your care, grounded in real services</h2><p>AI guidance is not currently connected. You can still book a visit, review your records, and message your care team through the available patient services.</p><div className="ai-actions"><a className="primary-button" href="/patient/appointments">Book an appointment <span aria-hidden="true">→</span></a><a className="secondary-button" href="/patient/messages">Message your care team</a></div></div></section>
    <section className="ai-section"><div className="section-heading"><div><p className="eyebrow">SERVICE DIRECTORY</p><h2>Health tools</h2></div><p>Availability reflects the services connected to this application.</p></div><div className="ai-service-grid">{services.map(([slug, title, type, description, status]) => <article className="ai-service-card" key={slug}><span className="ai-service-icon" aria-hidden="true">✳</span><div className="ai-service-title"><div><p className="eyebrow">{type}</p><h3>{title}</h3></div><span className="status-pill">{status}</span></div><p>{description}</p><a href={`/ai/${slug}`} className="card-link">Service details <span aria-hidden="true">→</span></a></article>)}<article className="ai-service-card ai-available"><span className="ai-service-icon" aria-hidden="true">⌕</span><div className="ai-service-title"><div><p className="eyebrow">PREFERENCE MATCHING</p><h3>Doctor recommendations</h3></div><span className="status-pill status-confirmed">Available</span></div><p>Find published appointment availability using preferences such as specialty, location, consultation mode, and fee.</p><a href="/patient/appointments#recommendations" className="card-link">Explore available doctors <span aria-hidden="true">→</span></a></article></div></section>
    <p className="notice notice-info ai-disclaimer"><strong>Clinical care comes first.</strong> This workspace does not diagnose, recommend treatment, or replace a qualified clinician. For urgent symptoms, contact local emergency services.</p>
  </main>;
}
