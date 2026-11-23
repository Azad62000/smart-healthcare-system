import { DashboardNav } from "./dashboard-nav";

const sources = [
  { title: "Disease trends dashboard", label: "IHIP · IDSP", description: "View the IHIP disease dashboard for surveillance trends. Sign-in may be required for detailed reports.", href: "https://ihip.mohfw.gov.in/idsp/#/reports/diseasedashboard" },
  { title: "Outbreak dashboard", label: "IHIP · IDSP", description: "Open the IHIP dashboard for outbreak information and district views. Sign-in may be required.", href: "https://ihip.mohfw.gov.in/idsp/#/outbreak/outbreak-dashboard" },
  { title: "Outbreak summary reports", label: "IHIP · IDSP", description: "Open IHIP outbreak summary reports. Sign-in may be required for report details.", href: "https://ihip.mohfw.gov.in/idsp/#/outbreak/outbreak-summary-report" }
];

export function IdspIntelligence() {
  return <main className="patient-dashboard ai-workspace">
    <DashboardNav currentPath="/ai" links={[{ href:"/patient",label:"Overview"},{href:"/ai",label:"Health services"},{href:"/patient/appointments",label:"Appointments"}]} />
    <a href="/ai" className="back-link">← All health services</a>
    <header className="dashboard-heading"><div><p className="eyebrow">IDSP · INTEGRATED DISEASE SURVEILLANCE PROGRAMME</p><h1>Disease Trends &amp; Outbreak Intelligence</h1><p>Find official Indian disease surveillance reports, outbreak alerts, and programme information.</p></div></header>
    <section className="dashboard-card">
      <div className="card-heading"><div><p className="eyebrow">HOW SURVEILLANCE IS REPORTED</p><h2>IDSP reporting streams</h2></div></div>
      <p>IDSP compiles weekly surveillance information and outbreak reports. Its reporting streams distinguish suspected syndromic signals, clinician presumptive cases, and laboratory-confirmed cases.</p>
      <div className="ai-service-grid">
        <article className="ai-service-card"><p className="eyebrow">S · SYNDROMIC</p><h3>Suspected cases</h3><p>Symptoms and syndromes reported by health workers can help identify unusual rises early.</p></article>
        <article className="ai-service-card"><p className="eyebrow">P · PRESUMPTIVE</p><h3>Clinician-reported</h3><p>Presumptive cases reported by clinicians contribute to weekly disease monitoring.</p></article>
        <article className="ai-service-card"><p className="eyebrow">L · LABORATORY</p><h3>Confirmed cases</h3><p>Laboratory-confirmed reports support verification and public health response.</p></article>
      </div>
    </section>
    <section className="ai-section"><div className="section-heading"><div><p className="eyebrow">OFFICIAL IHIP PAGES</p><h2>Reports and outbreak information</h2></div><p>Each link opens a specific IHIP dashboard or report page.</p></div><div className="ai-service-grid">{sources.map((source)=><article className="ai-service-card ai-available" key={source.title}><div className="ai-service-title"><div><p className="eyebrow">{source.label}</p><h3>{source.title}</h3></div><span className="status-pill status-confirmed">Official portal</span></div><p>{source.description}</p><a className="card-link" href={source.href} target="_blank" rel="noopener noreferrer">Open page <span aria-hidden="true">↗</span></a></article>)}</div></section>
    <p className="notice notice-info ai-disclaimer"><strong>Source and freshness.</strong> This page links to official IDSP resources; it does not import or reproduce live case counts. Check the source report date and State or district details. Surveillance alerts are for public health monitoring and do not diagnose an individual or confirm an outbreak unless verified by the responsible authorities.</p>
  </main>;
}
