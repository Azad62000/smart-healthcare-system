"use client";

import { FormEvent, useState } from "react";
const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const flags = ["family_history", "treated_hypertension", "cardiovascular_disease", "gestational_diabetes", "pcos", "learning_disability", "psychiatric_disorder", "corticosteroids", "statins", "atypical_antipsychotics"] as const;
const labels: Record<typeof flags[number], string> = { family_history:"First-degree family history", treated_hypertension:"Treated hypertension", cardiovascular_disease:"Cardiovascular disease", gestational_diabetes:"Gestational diabetes", pcos:"PCOS", learning_disability:"Learning disability", psychiatric_disorder:"Schizophrenia or bipolar disorder", corticosteroids:"Systemic corticosteroids", statins:"Statin use", atypical_antipsychotics:"Atypical antipsychotics" };
const errors = async (r: Response) => (await r.json().catch(() => ({}))).error?.message ?? "Could not calculate the risk estimate.";

export function QDiabetesModelC() {
  const [result, setResult] = useState<number | null>(null); const [error, setError] = useState(""); const [loading, setLoading] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setResult(null); setLoading(true);
    const f = new FormData(event.currentTarget); const value = (k: string) => f.get(k);
    const input = { sex: value("sex"), age: Number(value("age")), bmi: Number(value("bmi")), hba1c: Number(value("hba1c")), ethnicity: value("ethnicity"), smoking: value("smoking"), townsend: Number(value("townsend")), ...Object.fromEntries(flags.map((k) => [k, f.get(k) === "on"])) };
    try { const r = await fetch(`${apiUrl}/api/v1/ai/qdiabetes/model-c`, { method:"POST", credentials:"include", headers:{"content-type":"application/json"}, body:JSON.stringify(input) }); if (!r.ok) throw new Error(await errors(r)); const body = await r.json(); setResult(body.data.risk_percent); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not calculate the risk estimate."); } finally { setLoading(false); }
  }
  return <section className="dashboard-card"><div className="card-heading"><div><p className="eyebrow">QDIABETES-2018 MODEL C</p><h2>10-year risk estimate</h2></div></div>
    <p>Enter the model inputs, including relevant health history and medicines. Townsend score is a UK deprivation measure; this model has no India-specific equivalent.</p>
    <form className="profile-form" onSubmit={submit}>
      <div className="form-row"><label>Sex<select name="sex"><option>Female</option><option>Male</option></select></label><label>Age (25–84)<input name="age" type="number" min="25" max="84" required /></label></div>
      <div className="form-row"><label>BMI<input name="bmi" type="number" min="9.07" max="91.84" step="0.1" required /></label><label>HbA1c (mmol/mol)<input name="hba1c" type="number" min="15" max="47.99" step="0.1" required /></label></div>
      <div className="form-row"><label>Ethnicity<select name="ethnicity">{["WhiteNA","Indian","Pakistani","Bangladeshi","OtherAsian","BlackCaribbean","BlackAfrican","Chinese","Other"].map(x=><option key={x}>{x}</option>)}</select></label><label>Smoking<select name="smoking">{["Non","Ex","Light","Moderate","Heavy"].map(x=><option key={x}>{x}</option>)}</select></label></div>
      <label>Townsend score (−8 to 14)<input name="townsend" type="number" min="-8" max="14" step="0.01" defaultValue="0" required /></label>
      <div className="form-row">{flags.map((key)=><label key={key}><input type="checkbox" name={key}/> {labels[key]}</label>)}</div>
      <button className="primary-button" disabled={loading}>{loading ? "Calculating…" : "Calculate estimate"}</button>
    </form>
    {error && <p role="alert" className="notice notice-error">{error}</p>}{result !== null && <p role="status"><strong>Estimated 10-year risk: {result.toFixed(1)}%</strong></p>}
    <p className="notice notice-info"><strong>Important:</strong> QDiabetes was designed for UK populations and has not been validated for Indian patients. This is a risk estimate, not a diabetes diagnosis. Review it with a qualified clinician.</p>
  </section>;
}
