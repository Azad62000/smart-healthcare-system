"use client";

import { ChangeEvent, useEffect, useState } from "react";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
type Candidate = { label: string; confidence: number; box: { x1: number; y1: number; x2: number; y2: number } };
type Prediction = { model: string; imageWidth: number; imageHeight: number; confidenceThreshold: number; candidateRegions: Candidate[]; candidateCount: number; interpretation: string; warning: string };

export function FracAtlasFractureCheck() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [prediction, setPrediction] = useState<Prediction | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetch(`${apiUrl}/api/v1/ai/fracatlas/status`, { credentials: "include" })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error?.message ?? "Could not check the fracture service.");
        if (active) setConfigured(Boolean(body.data?.configured));
      })
      .catch(() => { if (active) setConfigured(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!file) { setPreview(""); return; }
    const objectUrl = URL.createObjectURL(file);
    setPreview(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.currentTarget.files?.[0];
    setError("");
    setPrediction(null);
    if (!selected) return;
    if (!(selected.type === "image/jpeg" || selected.type === "image/png")) { setFile(null); setError("Choose an X-ray image as JPG or PNG."); return; }
    if (selected.size > 10 * 1024 * 1024) { setFile(null); setError("Images must be 10 MB or smaller."); return; }
    setFile(selected);
  }

  async function analyze() {
    if (!file || busy || !configured) return;
    setBusy(true);
    setError("");
    setPrediction(null);
    try {
      const response = await fetch(`${apiUrl}/api/v1/ai/fracatlas/predict`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": file.type, "x-file-name": encodeURIComponent(file.name) },
        body: file
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error?.message ?? "The X-ray could not be analyzed.");
      setPrediction(body.data as Prediction);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The X-ray could not be analyzed. Please try again.");
    } finally { setBusy(false); }
  }

  return <section className="fracatlas-card dashboard-card" aria-label="FracAtlas X-ray fracture check">
    <header className="fracatlas-heading"><div><p className="eyebrow">EXPERIMENTAL IMAGE ANALYSIS</p><h2>Check an X-ray for candidate regions</h2></div><span className={`status-pill${configured ? " status-confirmed" : ""}`}>{configured === null ? "Checking service" : configured ? "Model ready" : "Setup needed"}</span></header>
    <p className="fracatlas-intro">Upload one musculoskeletal X-ray to highlight regions the FracAtlas localization model flags for review. This experimental research model cannot diagnose or rule out a fracture.</p>
    {configured === false && <div className="notice notice-info fracatlas-setup"><strong>Inference service is not running.</strong> Run <code>npm run setup:fracatlas</code> once, then <code>npm run dev:fracatlas</code>. First startup downloads the model weights.</div>}
    <div className="fracatlas-upload-row">
      <label className="secondary-button fracatlas-file-button">Choose X-ray<input type="file" accept="image/jpeg,image/png,.jpg,.jpeg,.png" onChange={chooseFile} disabled={!configured || busy} /></label>
      <span className="fracatlas-filename">{file ? `${file.name} · ${(file.size / 1024 / 1024).toFixed(1)} MB` : "JPG or PNG · up to 10 MB"}</span>
      <button type="button" className="primary-button" onClick={() => void analyze()} disabled={!file || !configured || busy}>{busy ? "Analyzing…" : "Check X-ray"}</button>
    </div>
    {error && <p className="notice notice-error" role="alert">{error}</p>}
    {preview && <div className="fracatlas-preview-wrap"><div className="fracatlas-preview" aria-label="Uploaded X-ray preview">
      {/* eslint-disable-next-line @next/next/no-img-element */}<img src={preview} alt="Selected X-ray image" />
      {prediction && <svg className="fracatlas-overlay" viewBox={`0 0 ${prediction.imageWidth} ${prediction.imageHeight}`} role="img" aria-label={`${prediction.candidateCount} model-highlighted candidate regions`}>
        {prediction.candidateRegions.map((candidate, index) => <g key={`${index}-${candidate.box.x1}`}><rect x={candidate.box.x1} y={candidate.box.y1} width={candidate.box.x2 - candidate.box.x1} height={candidate.box.y2 - candidate.box.y1} /><text x={candidate.box.x1} y={Math.max(14, candidate.box.y1 - 4)}>{candidate.label} · {Math.round(candidate.confidence * 100)}%</text></g>)}
      </svg>}
    </div></div>}
    {prediction && <div className={`fracatlas-result${prediction.candidateCount ? " has-candidates" : ""}`} aria-live="polite">
      <h3>{prediction.candidateCount ? `${prediction.candidateCount} candidate region${prediction.candidateCount === 1 ? "" : "s"} highlighted` : `No region scored above the ${Math.round(prediction.confidenceThreshold * 100)}% model-confidence cutoff`}</h3>
      {prediction.candidateCount > 0 && <ul>{prediction.candidateRegions.map((candidate, index) => <li key={index}>{candidate.label} · {Math.round(candidate.confidence * 100)}% model confidence</li>)}</ul>}
      <p>{prediction.candidateCount ? prediction.warning : `This result is inconclusive. Fractures can be missed because of image quality, view, anatomy, or model limitations. ${prediction.warning}`}</p>
    </div>}
    <p className="fracatlas-privacy">The image is sent to the FracAtlas inference service for this check and is not saved to chat or patient records.</p>
    <p className="notice notice-info ai-disclaimer"><strong>Clinical review required.</strong> The model was evaluated on a limited dataset and may miss fractures or highlight normal anatomy. A negative result does not rule out a fracture. Contact a clinician or radiologist for interpretation.</p>
  </section>;
}
