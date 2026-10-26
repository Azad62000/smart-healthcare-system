"use client";

import { FormEvent, useState } from "react";
import { apiData } from "../lib/api";

type Field = { name: string; label: string; type?: "text" | "number"; placeholder?: string };

export function AiFeatureForm({ feature, fields }: { feature: string; fields: Field[] }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setMessage("");
    const form = new FormData(event.currentTarget);
    const input = Object.fromEntries(fields.map((field) => {
      const value = String(form.get(field.name) ?? "").trim();
      return [field.name, field.type === "number" && value ? Number(value) : value];
    }));
    try {
      await apiData("/api/v1/ai/predictions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ feature, input }) });
      setMessage("No AI result is available.");
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "AI service is unavailable."); }
    finally { setBusy(false); }
  }
  return <section className="dashboard-card ai-integration-card">
    <p className="notice notice-info" role="status">AI model not configured yet. Submitting will receive an explicit unavailable response; no model result will be fabricated.</p>
    <form className="profile-form" onSubmit={(event) => void submit(event)}>
      {fields.map((field) => <label key={field.name}>{field.label}<input name={field.name} type={field.type ?? "text"} placeholder={field.placeholder} required={field.type === "number"} min={field.type === "number" ? 1 : undefined} maxLength={field.type === "number" ? undefined : 1000} /></label>)}
      <button className="primary-button" type="submit" disabled={busy}>{busy ? "Checking availability…" : "Check service availability"}</button>
    </form>
    {message && <p role="alert" className="notice notice-error">{message}</p>}
  </section>;
}
