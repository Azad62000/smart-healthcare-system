import { notFound } from "next/navigation";
import { DashboardNav } from "../../components/dashboard-nav";

const services: Record<string, { title: string; category: string; description: string }> = {
  "heart-risk": { title: "Heart health", category: "Risk assessment", description: "No heart health model is currently connected. This service does not collect health information or calculate a risk score." },
  "diabetes-risk": { title: "Diabetes", category: "Risk assessment", description: "No diabetes risk model is currently connected. No assessment is available." },
  "symptom-checker": { title: "Symptoms", category: "Health guidance", description: "Automated symptom assessment and triage are not available in this application." },
  "medical-image": { title: "Medical images", category: "Image analysis", description: "Image upload and analysis are not configured. No files are accepted on this page." },
  "medication-interactions": { title: "Medicine safety", category: "Interaction checking", description: "A medication reference database and interaction checker are not connected." },
  "health-trends": { title: "Health trends", category: "Longitudinal view", description: "Longitudinal health analysis is not currently available." }
};

export default async function AiFeaturePage({ params }: { params: Promise<{ feature: string }> }) {
  const { feature } = await params;
  const service = services[feature];
  if (!service) notFound();
  return <main className="patient-dashboard ai-workspace">
    <DashboardNav currentPath="/ai" links={[{ href: "/patient", label: "Overview" }, { href: "/ai", label: "AI services" }, { href: "/patient/appointments", label: "Appointments" }]} />
    <a href="/ai" className="back-link">← All health services</a>
    <header className="dashboard-heading"><div><p className="eyebrow">{service.category}</p><h1>{service.title}</h1><p>{service.description}</p></div></header>
    <section className="service-detail-panel dashboard-card"><span className="service-detail-icon" aria-hidden="true">✳</span><div><span className="status-pill">Unavailable</span><h2>This service is not connected</h2><p>Automated health guidance is optional. Your core care tasks are still available through appointments and records. Chat with your care team during video consultations.</p><div className="ai-actions"><a className="primary-button" href="/patient/appointments">View appointments</a></div></div></section>
    <p className="notice notice-info ai-disclaimer"><strong>For your safety.</strong> This service does not provide medical advice, diagnosis, or treatment. Contact a qualified clinician about health concerns.</p>
  </main>;
}
