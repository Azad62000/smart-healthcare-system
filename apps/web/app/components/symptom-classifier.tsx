"use client";

import { FormEvent, useState } from "react";
import { apiData } from "../lib/api";

type Match = { label: string; score: number };
type Classification = { model: string; matches: Match[]; notice: string };

export function SymptomClassifier() {
  const [symptoms, setSymptoms] = useState("");
  const [result, setResult] = useState<Classification | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function classify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true); setError(""); setResult(null);
    try {
      const response = await apiData<Classification>("/api/v1/ai/symptoms/classify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ symptoms })
      });
      setResult(response);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The symptom model is unavailable.");
    } finally { setLoading(false); }
  }

  return <section className="dashboard-card symptom-classifier">
    <div className="card-heading"><div><p className="eyebrow">EXPERIMENTAL TEXT CLASSIFIER</p><h2>Describe your symptoms</h2></div><span className="card-icon" aria-hidden="true">⌕</span></div>
    <p className="notice notice-info symptom-urgent"><strong>If symptoms are severe or rapidly worsening, contact local emergency services now.</strong> This tool does not assess urgency or provide medical advice.</p>
    <form className="profile-form" onSubmit={(event) => void classify(event)}>
      <label htmlFor="symptom-description">Symptoms<textarea id="symptom-description" value={symptoms} onChange={(event) => setSymptoms(event.target.value)} minLength={12} maxLength={3000} rows={6} required placeholder="Describe what you are experiencing, when it began, and any changes." /></label>
      <button className="primary-button" type="submit" disabled={loading || symptoms.trim().length < 12}>{loading ? "Loading model and checking matches…" : "Show model matches"}</button>
    </form>
    {error && <p role="alert" className="notice notice-error">{error}</p>}
    {result && <section className="symptom-results" aria-live="polite"><p className="eyebrow">MODEL MATCHES · NOT A DIAGNOSIS</p><ul>{result.matches.map((match) => <li key={match.label}><span>{match.label}</span><strong>Model score {(match.score * 100).toFixed(1)}%</strong></li>)}</ul><p>The model score is not a probability that you have a condition. These results do not confirm or rule out illness. Discuss health concerns with a qualified clinician.</p></section>}
  </section>;
}
