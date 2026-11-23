"use client";
import { FormEvent, useState } from "react";
const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const bands: Record<string, { label: string; note: string }> = {
  low: { label: "<5% · Low", note: "Green band" }, moderate: { label: "5% to <10% · Moderate", note: "Yellow band" },
  high: { label: "10% to <20% · High", note: "Orange band" }, very_high: { label: "20% to <30% · Very high", note: "Red band" }, critical: { label: "≥30% · Very high", note: "Dark red band" }
};
export function WhoCvdSouthAsia() {
  const [result, setResult] = useState<{percent:number;category:string}|null>(null); const [error,setError]=useState(""); const [loading,setLoading]=useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();setError("");setResult(null);setLoading(true);const form=new FormData(event.currentTarget);
    const input={age:Number(form.get("age")),sex:String(form.get("sex")),smoker:form.get("smoker")==="yes",bmi:Number(form.get("bmi")),systolicBp:Number(form.get("systolicBp"))};
    try { const response=await fetch(`${apiUrl}/api/v1/ai/who-cvd/south-asia`,{method:"POST",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify(input)});const body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(body.error?.message??"Could not calculate the estimate.");setResult(body.data); }
    catch(cause){setError(cause instanceof Error?cause.message:"Could not calculate the estimate.");}finally{setLoading(false);}
  }
  return <section className="dashboard-card"><div className="card-heading"><div><p className="eyebrow">WHO CVD RISK CHARTS · SOUTH ASIA</p><h2>10-year cardiovascular risk estimate</h2></div></div>
    <p>This non-laboratory chart estimates risk from age, sex, smoking, BMI, and systolic blood pressure. Use measured blood pressure and a current height and weight.</p>
    <form className="profile-form" onSubmit={submit}>
      <div className="form-row"><label>Age (40–74 years)<input name="age" type="number" min="40" max="74" step="1" required /></label><label>Sex<select name="sex"><option>Female</option><option>Male</option></select></label></div>
      <div className="form-row"><label>BMI (kg/m²)<input name="bmi" type="number" min="10" max="80" step="0.1" required /></label><label>Systolic blood pressure (mmHg)<input name="systolicBp" type="number" min="70" max="260" required /></label></div>
      <label>Current smoker?<select name="smoker"><option value="no">No</option><option value="yes">Yes</option></select></label>
      <button className="primary-button" disabled={loading}>{loading?"Calculating…":"Calculate estimate"}</button>
    </form>
    {error&&<p role="alert" className="notice notice-error">{error}</p>}
    {result&&<div role="status" className="notice notice-info"><strong>Estimated 10-year risk: {result.percent}% ({bands[result.category]?.label})</strong><p>{bands[result.category]?.note}. WHO chart risk bands are &lt;5%, 5–&lt;10%, 10–&lt;20%, 20–&lt;30%, and ≥30%.</p></div>}
    <p className="notice notice-info"><strong>Use with a clinician.</strong> This estimates the chance of a major cardiovascular event over 10 years. It is not a diagnosis or a substitute for clinical assessment. The WHO South Asia chart is intended for the region, including India.</p>
    <p>Source: <a href="https://www.who.int/docs/default-source/cardiovascular-diseases/south-asia.pdf" target="_blank" rel="noreferrer">WHO 2019 South Asia non-laboratory CVD risk chart (PDF)</a>. This page uses its published age, BMI, and blood-pressure bands; it does not interpolate between them.</p>
  </section>;
}
