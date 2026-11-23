"use client";

import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader, type IScannerControls } from "@zxing/browser";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
type DrugSuggestion = Record<string, unknown> & { brandIdentifier?: string; brandName?: string; genericName?: string; supplierName?: string };

function asText(value: unknown) { return typeof value === "string" || typeof value === "number" ? String(value) : ""; }

export function DrugChecker() {
  const video = useRef<HTMLVideoElement>(null);
  const scanner = useRef<IScannerControls | null>(null);
  const [search, setSearch] = useState("");
  const [code, setCode] = useState("");
  const [results, setResults] = useState<Array<Record<string, unknown>>>([]);
  const [selectedDetails, setSelectedDetails] = useState<Record<string, unknown> | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [scanMessage, setScanMessage] = useState("");
  const [verificationUrl, setVerificationUrl] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);

  useEffect(() => () => scanner.current?.stop(), []);

  async function startScan() {
    setError(""); setScanMessage(""); setVerificationUrl("");
    if (!navigator.mediaDevices?.getUserMedia) { setError("Camera scanning requires a secure HTTPS page or localhost."); return; }
    try {
      const reader = new BrowserMultiFormatReader();
      scanner.current = await reader.decodeFromVideoDevice(undefined, video.current!, (result, _error, controls) => {
        scanner.current = controls;
        if (result) {
          const text = result.getText(); setCode(text); setScanning(false); controls.stop();
          setScanMessage(`Captured ${String(result.getBarcodeFormat()).toLowerCase()} code. Checking available details…`);
          void checkCode(text);
        }
      });
      setScanning(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not start the camera. Check camera permission and try again."); }
  }

  async function checkCode(value: string) {
    const parsed = parseStructuredQr(value);
    if (parsed) { setResults([parsed]); setScanMessage("Product details were read from the QR payload. This does not independently authenticate the pack."); return; }
    setResults([]); setVerificationUrl("");
    try {
      const response = await fetch(`${apiUrl}/api/v1/drugs/barcode?code=${encodeURIComponent(value)}`, { credentials: "include" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Could not check this code.");
      if (body.data.registryMatch) setResults([body.data.registryMatch]);
      if (body.data.verificationUrl) setVerificationUrl(body.data.verificationUrl);
      setScanMessage(body.data.message);
    } catch (cause) { setScanMessage(cause instanceof Error ? cause.message : "Code captured, but no pack verification result is available."); }
  }

  function parseStructuredQr(value: string): Record<string, unknown> | null {
    if (/^https?:\/\//i.test(value.trim())) return null;
    try {
      const parsed = JSON.parse(value) as Record<string, unknown>;
      if (parsed && typeof parsed === "object") return parsed;
    } catch { /* Most manufacturer QR payloads are plain text or URLs. */ }
    const fields: Record<string, unknown> = {};
    for (const piece of value.split(/[|\n;]/)) {
      const match = piece.match(/^\s*([^:=]+)\s*[:=]\s*(.+)\s*$/);
      if (match) fields[match[1].trim()] = match[2].trim();
    }
    return Object.keys(fields).length ? fields : null;
  }

  async function findDrug(event: React.FormEvent) {
    event.preventDefault(); setLoading(true); setError(""); setResults([]); setSelectedDetails(null); setScanMessage(""); setVerificationUrl("");
    try {
      const response = await fetch(`${apiUrl}/api/v1/drugs/search?q=${encodeURIComponent(search)}`, { credentials: "include" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Drug search failed.");
      setResults(body.data.results ?? []);
      setScanMessage(body.data.results?.length ? "Choose a match to view ABDM Registry details. Catalog information does not authenticate an individual pack." : "No matching drug records were returned.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not search the drug registry."); }
    finally { setLoading(false); }
  }

  async function loadDrugDetails(suggestion: DrugSuggestion) {
    if (!suggestion.brandIdentifier) return;
    setDetailsLoading(true); setError(""); setSelectedDetails(null);
    try {
      const response = await fetch(`${apiUrl}/api/v1/drugs/details/${encodeURIComponent(suggestion.brandIdentifier)}`, { credentials: "include" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Could not load drug details.");
      setSelectedDetails(body.data.details);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load drug details."); }
    finally { setDetailsLoading(false); }
  }

  async function submitCode(event: React.FormEvent) { event.preventDefault(); await checkCode(code.trim()); }

  return <section className="dashboard-card drug-checker">
    <div className="card-heading"><div><p className="eyebrow">MEDICINE INFORMATION</p><h2>Check a medicine</h2></div><span className="card-icon" aria-hidden="true">▦</span></div>
    <p>Search ABDM’s Drug Registry for medicine details, or scan the pack QR/barcode. A registry listing does not verify an individual package.</p>
    <div className="drug-checker-actions"><button className="primary-button" type="button" onClick={() => scanning ? (scanner.current?.stop(), setScanning(false)) : void startScan()}>{scanning ? "Stop camera" : "Scan with camera"}</button><label className="secondary-button drug-upload">Scan from image<input type="file" accept="image/*" capture="environment" onChange={async (event) => {
      const file = event.target.files?.[0]; if (!file) return;
      try { const reader = new BrowserMultiFormatReader(); const result = await reader.decodeFromImageUrl(URL.createObjectURL(file)); const text = result.getText(); setCode(text); setScanMessage("Code read from image. Checking available details…"); await checkCode(text); }
      catch { setError("No QR code or barcode could be read from that image."); }
      event.currentTarget.value = "";
    }} /></label></div>
    {scanning && <video ref={video} className="drug-scanner-video" muted playsInline aria-label="Camera view for scanning a medicine code" />}
    <form className="profile-form drug-code-form" onSubmit={submitCode}><label>Enter QR contents or barcode<input value={code} onChange={(event) => setCode(event.target.value)} maxLength={512} placeholder="Scan or type the code" /></label><button className="secondary-button" type="submit" disabled={!code.trim()}>Read code</button></form>
    <form className="profile-form drug-search-form" onSubmit={findDrug}><label>Search ABDM Drug Registry<input value={search} onChange={(event) => setSearch(event.target.value)} minLength={3} maxLength={200} placeholder="Generic name, brand, or ingredient" /></label><button className="secondary-button" type="submit" disabled={loading || search.trim().length < 3}>{loading ? "Searching…" : "Search medicines"}</button></form>
    {error && <p className="notice notice-error" role="alert">{error}</p>}{scanMessage && <p className="notice" role="status">{scanMessage}</p>}{verificationUrl && <p><a href={verificationUrl} target="_blank" rel="noreferrer">Open government pack verification page</a></p>}
    {results.length > 0 && <ul className="drug-result-list">{results.map((raw, index) => { const result = raw as DrugSuggestion; return <li key={result.brandIdentifier || index}><div className="drug-result-summary"><strong>{asText(result.brandName) || "Medicine"}</strong><span>Generic: {asText(result.genericName) || "Not listed"}</span><span>Manufacturer: {asText(result.supplierName) || "See details"}</span></div><button type="button" className="secondary-button" disabled={!result.brandIdentifier || detailsLoading} onClick={() => void loadDrugDetails(result)}>{detailsLoading ? "Loading…" : "View details"}</button></li>; })}</ul>}
    {selectedDetails && <DrugDetailsPanel details={selectedDetails} />}
    <p className="drug-auth-note">Do not use a scan or registry match to decide whether to take a medicine. If the pack is damaged, expired, or suspicious, ask a pharmacist or contact the manufacturer.</p>
  </section>;
}

function DrugDetailsPanel({ details }: { details: Record<string, unknown> }) {
  const brand = (details.brand && typeof details.brand === "object" ? details.brand : {}) as Record<string, unknown>;
  const generic = (details.generic && typeof details.generic === "object" ? details.generic : {}) as Record<string, unknown>;
  const supplier = (details.supplier && typeof details.supplier === "object" ? details.supplier : {}) as Record<string, unknown>;
  const product = (details.product && typeof details.product === "object" ? details.product : {}) as Record<string, unknown>;
  const substances = Array.isArray(details.substances) ? details.substances.map((value) => asText((value as Record<string, unknown>).name)).filter(Boolean).join(", ") : "";
  const routes = Array.isArray(details.routeOfAdministrations) ? details.routeOfAdministrations.map((value) => asText((value as Record<string, unknown>).name)).filter(Boolean).join(", ") : "";
  const rows: Array<[string, unknown]> = [
    ["Brand / drug", brand.name], ["Generic", generic.name], ["Manufacturer / supplier", supplier.name],
    ["Product", product.name], ["Active ingredient(s)", substances], ["Dosage form", details.doseForm],
    ["Route", routes], ["Registry license status", brand.licenseStatus], ["Typical uses", generic.indication],
    ["Listed contraindications", generic.contraIndication]
  ];
  return <section className="drug-details-panel" aria-label="ABDM Drug Registry details"><h3>{asText(brand.name) || "Drug details"}</h3><dl>{rows.filter(([, value]) => value !== undefined && value !== null && value !== "").map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{asText(value)}</dd></div>)}</dl><p>Registry content is reference information and may be incomplete. Confirm clinical decisions with a pharmacist or clinician. Registry license status does not authenticate this package.</p></section>;
}
