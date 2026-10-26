import { DashboardNav } from "../components/dashboard-nav";

const features = [
  ["heart-risk", "Heart disease risk", "Future integration point for a model supplied by the project owner."],
  ["diabetes-risk", "Diabetes risk", "Future integration point; no prediction is currently available."],
  ["symptom-checker", "Symptom-based analysis", "No diagnosis or symptom inference is available."],
  ["general-health-risk", "General health assessment", "No health risk assessment model is configured."],
  ["medical-image", "Medical image analysis", "Image upload and analysis are not configured."],
  ["doctor-recommendations", "Doctor recommendations", "Rule-based doctor availability suggestions are available on the booking page."],
  ["medication-interactions", "Medicine interaction checking", "No medication interaction database or checker is configured."],
  ["health-trends", "Patient health trends", "No longitudinal analysis service is configured."]
];

export default function AiServicesPage() {
  return <main className="patient-dashboard">
    <DashboardNav currentPath="/ai" links={[{ href: "/patient", label: "Overview" }, { href: "/patient/appointments", label: "Appointments" }, { href: "/patient/records", label: "Health records" }, { href: "/ai", label: "AI services" }, { href: "/chat", label: "Health chat" }]} />
    <header className="dashboard-heading"><div><p className="eyebrow">OPTIONAL INTEGRATIONS</p><h1>AI services</h1><p>Integration pages are prepared, but no medical AI models are connected.</p></div></header>
    <p className="notice notice-info">Experimental integration interfaces only. They do not provide medical advice, predictions, or diagnoses. Do not use them in place of a qualified healthcare professional.</p>
    <div className="directory-grid">{features.map(([slug, name, description]) => slug === "doctor-recommendations"
      ? <article className="dashboard-card" key={slug}><p className="eyebrow">AVAILABLE</p><h2>{name}</h2><p>{description}</p><a className="secondary-button" href="/patient/appointments">Open appointment suggestions</a></article>
      : <article className="dashboard-card" key={slug}><p className="eyebrow">NOT CONFIGURED</p><h2>{name}</h2><p>{description}</p><a className="secondary-button" href={`/ai/${slug}`}>View integration page</a></article>)}</div>
  </main>;
}
