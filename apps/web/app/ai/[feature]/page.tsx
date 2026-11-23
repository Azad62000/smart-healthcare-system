import { notFound } from "next/navigation";
import { DashboardNav } from "../../components/dashboard-nav";
import { QDiabetesModelC } from "../../components/qdiabetes-model-c";
import { WhoCvdSouthAsia } from "../../components/who-cvd-south-asia";
import { IdspIntelligence } from "../../components/idsp-intelligence";
import { DrugChecker } from "../../components/drug-checker";
import { SymptomClassifier } from "../../components/symptom-classifier";

const services: Record<string, { title: string; category: string; description: string }> = {
  "heart-risk": { title: "Cardiovascular Disease (CVD) Risk Prediction", category: "WHO CVD Risk Charts · South Asia", description: "Estimate 10-year cardiovascular risk with the WHO South Asia non-laboratory chart." },
  "diabetes-risk": { title: "Diabetes risk estimate", category: "QDiabetes-2018 Model C", description: "Calculate a 10-year risk estimate using HbA1c and the original QDiabetes-2018 Model C algorithm." },
  "symptom-checker": { title: "Symptoms", category: "Public BERT Symptom Classifier", description: "Compare an English symptom description with the model’s 22 condition labels. Experimental; not clinical advice or triage." },
  "medical-image": { title: "Medical images", category: "Image analysis", description: "Image upload and analysis are not configured. No files are accepted on this page." },
  "medication-interactions": { title: "Know Your Drug", category: "Medicine details & pack scanning", description: "Search medicine registry details and scan QR codes or barcodes to read package information." },
  "health-trends": { title: "Disease Trends & Outbreak Intelligence", category: "IDSP · Integrated Disease Surveillance Programme", description: "Official Indian surveillance reports, weekly outbreak alerts, and programme information." }
};

export default async function AiFeaturePage({ params }: { params: Promise<{ feature: string }> }) {
  const { feature } = await params;
  const service = services[feature];
  if (!service) notFound();
  if (feature === "health-trends") return <IdspIntelligence />;
  if (feature === "symptom-checker") return <main className="patient-dashboard ai-workspace">
    <DashboardNav currentPath="/ai" links={[{ href: "/patient", label: "Overview" }, { href: "/ai", label: "AI services" }, { href: "/patient/appointments", label: "Appointments" }]} />
    <a href="/ai" className="back-link">← All health services</a>
    <header className="dashboard-heading"><div><p className="eyebrow">{service.category}</p><h1>{service.title}</h1><p>{service.description}</p></div></header>
    <SymptomClassifier />
    <p className="notice notice-info ai-disclaimer"><strong>For your safety.</strong> This experimental classifier does not diagnose conditions, recommend treatment, or assess emergencies. If you are concerned about your health, contact a qualified clinician.</p>
  </main>;
  if (feature === "medication-interactions") return <main className="patient-dashboard ai-workspace">
    <DashboardNav currentPath="/ai" links={[{ href: "/patient", label: "Overview" }, { href: "/ai", label: "AI services" }, { href: "/patient/appointments", label: "Appointments" }]} />
    <a href="/ai" className="back-link">← All health services</a>
    <header className="dashboard-heading"><div><p className="eyebrow">{service.category}</p><h1>{service.title}</h1><p>{service.description}</p></div></header>
    <DrugChecker />
    <p className="notice notice-info ai-disclaimer"><strong>Know the limits.</strong> Product details or a registry match do not prove an individual pack is genuine. Only rely on an authorized manufacturer or regulator verification result, and ask a pharmacist if a package seems suspicious.</p>
  </main>;
  return <main className="patient-dashboard ai-workspace">
    <DashboardNav currentPath="/ai" links={[{ href: "/patient", label: "Overview" }, { href: "/ai", label: "AI services" }, { href: "/patient/appointments", label: "Appointments" }]} />
    <a href="/ai" className="back-link">← All health services</a>
    <header className="dashboard-heading"><div><p className="eyebrow">{service.category}</p><h1>{service.title}</h1><p>{service.description}</p></div></header>
    {feature === "diabetes-risk" ? <QDiabetesModelC /> : feature === "heart-risk" ? <WhoCvdSouthAsia /> : <><section className="service-detail-panel dashboard-card"><span className="service-detail-icon" aria-hidden="true">✳</span><div><span className="status-pill">Unavailable</span><h2>This service is not connected</h2><p>Automated health guidance is optional. Your core care tasks are still available through appointments and records. Chat with your care team during video consultations.</p><div className="ai-actions"><a className="primary-button" href="/patient/appointments">View appointments</a></div></div></section><p className="notice notice-info ai-disclaimer"><strong>For your safety.</strong> This service does not provide medical advice, diagnosis, or treatment. Contact a qualified clinician about health concerns.</p></>}
  </main>;
}
