import { notFound } from "next/navigation";
import { AiFeatureForm } from "../../components/ai-feature-form";
import { DashboardNav } from "../../components/dashboard-nav";

const definitions: Record<string, { title: string; description: string; fields: Array<{ name: string; label: string; type?: "text" | "number"; placeholder?: string }> }> = {
  "heart-risk": { title: "Heart disease risk", description: "Provisional input schema for a future integration. No risk score is calculated.", fields: [{ name: "age", label: "Age", type: "number" }, { name: "systolicPressure", label: "Systolic pressure", type: "number" }, { name: "cholesterol", label: "Cholesterol", type: "number" }] },
  "diabetes-risk": { title: "Diabetes risk", description: "Provisional integration fields only; no clinical assessment is performed.", fields: [{ name: "age", label: "Age", type: "number" }, { name: "bodyMassIndex", label: "Body mass index", type: "number" }, { name: "familyHistory", label: "Family history (optional)", placeholder: "Not configured for analysis" }] },
  "symptom-checker": { title: "Symptom-based analysis", description: "This interface does not provide a diagnosis or triage recommendation.", fields: [{ name: "symptoms", label: "Symptoms (optional integration input)", placeholder: "Do not enter sensitive details; no service is configured." }] },
  "general-health-risk": { title: "General health assessment", description: "A future typed integration point. No risk classification is available.", fields: [{ name: "age", label: "Age", type: "number" }, { name: "context", label: "Assessment context", placeholder: "Integration not configured" }] },
  "medical-image": { title: "Medical image analysis", description: "Image upload and image analysis are not configured; files are not accepted.", fields: [{ name: "imageStatus", label: "Image input", placeholder: "Unavailable until a secure storage and model adapter is configured" }] },
  "medication-interactions": { title: "Medicine interaction checking", description: "No medication reference data or interaction checker is configured.", fields: [{ name: "medications", label: "Medication names (optional integration input)", placeholder: "No interaction service is configured" }] },
  "health-trends": { title: "Patient health trends", description: "No longitudinal health analysis is configured.", fields: [{ name: "period", label: "Requested period", placeholder: "No trend service is configured" }] }
};

export default async function AiFeaturePage({ params }: { params: Promise<{ feature: string }> }) {
  const { feature } = await params;
  const definition = definitions[feature];
  if (!definition) notFound();
  return <main className="patient-dashboard">
    <DashboardNav currentPath="/ai" links={[{ href: "/patient", label: "Overview" }, { href: "/ai", label: "AI services" }, { href: "/patient/appointments", label: "Appointments" }]} />
    <header className="dashboard-heading"><div><p className="eyebrow">OPTIONAL INTEGRATION</p><h1>{definition.title}</h1><p>{definition.description}</p></div><a className="secondary-button" href="/ai">All AI services</a></header>
    <AiFeatureForm feature={feature} fields={definition.fields} />
    <p className="notice notice-info">Experimental interface only. No medical advice, prediction, diagnosis, or treatment recommendation is provided. Consult a qualified healthcare professional.</p>
  </main>;
}
