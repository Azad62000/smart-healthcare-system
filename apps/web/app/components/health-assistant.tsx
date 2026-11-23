"use client";

import { FormEvent, KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
type Message = { id: string; role: "user" | "assistant"; content: string; createdAt?: string };
type Conversation = { id: string; createdAt: string; updatedAt: string; preview: string | null };

function encodeHeaderText(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

export function HealthAssistant() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [reportText, setReportText] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [reportMode, setReportMode] = useState(false);
  const [freeTierAcknowledged, setFreeTierAcknowledged] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [error, setError] = useState("");
  const historyRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadConversations = useCallback(async () => {
    const response = await fetch(`${apiUrl}/api/v1/ai/gemini/conversations`, { credentials: "include" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error?.message ?? "Could not load chat history.");
    setConversations(body.data.conversations as Conversation[]);
  }, []);

  const selectConversation = useCallback(async (id: string) => {
    setLoadingHistory(true);
    setError("");
    try {
      const response = await fetch(`${apiUrl}/api/v1/ai/gemini/conversations/${id}/messages`, { credentials: "include" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error?.message ?? "Could not load this conversation.");
      setConversationId(id);
      setMessages(body.data.messages as Message[]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load this conversation."); }
    finally { setLoadingHistory(false); }
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const statusResponse = await fetch(`${apiUrl}/api/v1/ai/gemini/status`, { credentials: "include" });
        const statusBody = await statusResponse.json().catch(() => ({}));
        if (!statusResponse.ok) throw new Error(statusBody.error?.message ?? "Could not check assistant status.");
        if (active) setConfigured(Boolean(statusBody.data?.configured));
        const historyResponse = await fetch(`${apiUrl}/api/v1/ai/gemini/conversations`, { credentials: "include" });
        const historyBody = await historyResponse.json().catch(() => ({}));
        if (!historyResponse.ok) throw new Error(historyBody.error?.message ?? "Could not load chat history.");
        const items = historyBody.data.conversations as Conversation[];
        if (active) setConversations(items);
        if (active && items.length) await selectConversation(items[0]!.id);
      } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : "The health assistant is unavailable."); }
      finally { if (active) setLoadingHistory(false); }
    })();
    return () => { active = false; };
  }, [selectConversation]);

  useEffect(() => { historyRef.current?.scrollTo({ top: historyRef.current.scrollHeight, behavior: "smooth" }); }, [messages, busy]);

  async function send(event?: FormEvent) {
    event?.preventDefault();
    const content = draft.trim();
    const report = reportMode ? reportText.trim() : "";
    const file = selectedFile;
    if ((!content && !report && !file) || busy || !configured || !freeTierAcknowledged) return;
    if (file && content.length > 2000) { setError("Keep the message under 2,000 characters when attaching a file."); return; }
    if (file && report.length > 1500) { setError("When attaching a file, keep pasted report text under 1,500 characters."); return; }
    const prompt = content || (file ? "Please explain the attached medical file in plain language and suggest questions I can ask my clinician." : "Please explain this medical report in plain language and suggest questions I can ask my clinician.");
    const userContent = report ? `${prompt}\n\nMedical report text:\n${report}` : prompt;
    const displayedContent = file ? `${userContent}\n\nAttached file: ${file.name}` : userContent;
    const pendingId = `pending-${Date.now()}`;
    setMessages((current) => [...current, { id: pendingId, role: "user", content: displayedContent }]);
    setDraft("");
    if (report) setReportText("");
    setBusy(true);
    setError("");
    try {
      const response = file
        ? await fetch(`${apiUrl}/api/v1/ai/gemini/chat-file`, {
          method: "POST", credentials: "include",
          headers: {
            "content-type": file.type,
            "x-file-name": encodeURIComponent(file.name),
            "x-chat-message": encodeHeaderText(userContent),
            "x-free-tier-acknowledged": "true",
            ...(conversationId ? { "x-conversation-id": conversationId } : {})
          },
          body: file
        })
        : await fetch(`${apiUrl}/api/v1/ai/gemini/chat`, {
          method: "POST", credentials: "include", headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...(conversationId ? { conversationId } : {}), message: prompt, ...(report ? { reportText: report } : {}), freeTierAcknowledged: true })
        });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error?.message ?? "The assistant could not answer. Please try again.");
      setConversationId(body.data.conversationId as string);
      setMessages((current) => [...current.filter((message) => message.id !== pendingId), ...(body.data.messages as Message[])]);
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      void loadConversations().catch(() => setError("Your reply was saved, but the conversation list could not refresh."));
    } catch (cause) {
      setMessages((current) => current.filter((message) => message.id !== pendingId));
      setDraft(content);
      if (report) setReportText(report);
      setError(cause instanceof Error ? cause.message : "The assistant could not answer. Please try again.");
    } finally { setBusy(false); }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); }
  }

  function startNewConversation() { setConversationId(null); setMessages([]); setDraft(""); setReportText(""); setSelectedFile(null); if (fileInputRef.current) fileInputRef.current.value = ""; setError(""); }

  function chooseFile(file: File | undefined) {
    setError("");
    if (!file) return;
    const allowedTypes = ["application/pdf", "image/jpeg", "image/png"];
    if (!allowedTypes.includes(file.type)) { setSelectedFile(null); setError("Choose a PDF, JPG, or PNG report image."); return; }
    if (file.size > 8 * 1024 * 1024) { setSelectedFile(null); setError("Files must be 8 MB or smaller."); return; }
    setSelectedFile(file);
  }

  async function deleteConversation(id: string) {
    try {
      const response = await fetch(`${apiUrl}/api/v1/ai/gemini/conversations/${id}`, { method: "DELETE", credentials: "include" });
      if (!response.ok) throw new Error("Could not delete this conversation.");
      setConversations((current) => current.filter((item) => item.id !== id));
      if (conversationId === id) startNewConversation();
    } catch { setError("Could not delete this conversation."); }
  }

  return <div className="health-assistant-layout">
    <aside className="health-assistant-history dashboard-card" aria-label="Your chat history">
      <div className="health-assistant-history-heading"><h2>Conversations</h2><button className="secondary-button" type="button" onClick={startNewConversation} disabled={busy}>New chat</button></div>
      {loadingHistory ? <p className="form-help">Loading your history…</p> : conversations.length ? <ul>{conversations.map((conversation) => <li key={conversation.id} className={conversation.id === conversationId ? "is-active" : ""}>
        <button type="button" onClick={() => void selectConversation(conversation.id)} disabled={busy} aria-current={conversation.id === conversationId ? "page" : undefined}>
          <span>{conversation.preview || "New conversation"}</span><time dateTime={conversation.updatedAt}>{new Date(conversation.updatedAt).toLocaleDateString()}</time>
        </button><button type="button" className="text-button history-delete" onClick={() => void deleteConversation(conversation.id)} disabled={busy} aria-label="Delete conversation">Delete</button>
      </li>)}</ul> : <p className="form-help">Your saved conversations will appear here.</p>}
    </aside>
    <section className="assistant-panel dashboard-card" aria-labelledby="assistant-title">
      <div className="assistant-topline"><div className="assistant-avatar" aria-hidden="true">✳</div><div><h2 id="assistant-title">How can we help?</h2><p>Google Gemini · Health assistant</p></div><span className="service-indicator"><i />{configured === null ? "Checking" : configured ? "Connected" : "Setup needed"}</span></div>
      <div className="assistant-conversation" ref={historyRef} aria-live="polite">
        {loadingHistory ? <div className="assistant-message"><p>Loading your conversation…</p></div> : messages.length === 0 && <div className="assistant-message"><p>{configured === false ? "Google Gemini is not configured for this deployment. Ask your administrator to add a Gemini API key." : "Ask a general health question, describe symptoms, or paste report text for a plain-language explanation."}</p></div>}
        {messages.map((message) => <div className={`assistant-message${message.role === "user" ? " assistant-message-user" : ""}`} key={message.id}><p>{message.content}</p></div>)}
        {busy && <div className="assistant-message"><p>Gemini is preparing a response…</p></div>}
      </div>
      {error && <p className="notice notice-error" role="alert">{error}</p>}
      <form className="assistant-composer" onSubmit={(event) => void send(event)}>
        <label className="sr-only" htmlFor="assistant-input">Message</label>
        <textarea id="assistant-input" rows={2} maxLength={selectedFile ? 2000 : 4000} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={onKeyDown} disabled={configured !== true || busy || loadingHistory} placeholder={configured === false ? "Assistant setup is required" : "Ask a health question…"} aria-describedby="assistant-note" />
        {reportMode && <div className="assistant-report-input"><label htmlFor="assistant-report">Paste report text to explain</label><textarea id="assistant-report" rows={5} maxLength={20000} value={reportText} onChange={(event) => setReportText(event.target.value)} disabled={configured !== true || busy || loadingHistory} placeholder="Paste relevant text only. Remove names, IDs, and contact details." /></div>}
        {selectedFile && <div className="assistant-file-chip"><span aria-hidden="true">▧</span><span>{selectedFile.name} · {(selectedFile.size / 1024 / 1024).toFixed(1)} MB</span><button type="button" className="text-button" onClick={() => { setSelectedFile(null); if (fileInputRef.current) fileInputRef.current.value = ""; }} disabled={busy} aria-label="Remove attachment">Remove</button></div>}
        <div className="assistant-composer-actions"><div className="assistant-attach-actions"><button type="button" className="text-button" onClick={() => fileInputRef.current?.click()} disabled={configured !== true || busy || loadingHistory || reportMode}>Attach report</button><input ref={fileInputRef} className="sr-only" type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" onChange={(event) => chooseFile(event.currentTarget.files?.[0])} aria-label="Attach a PDF or medical report image" /><button type="button" className="text-button" onClick={() => setReportMode((current) => !current)} disabled={configured !== true || busy || Boolean(selectedFile)}>{reportMode ? "Hide report" : "Paste report"}</button></div><button type="submit" className="primary-button" disabled={configured !== true || busy || loadingHistory || !freeTierAcknowledged || (!draft.trim() && !(reportMode && reportText.trim()) && !selectedFile)} aria-label="Send message">↑</button></div>
        <p className="assistant-file-note">PDF, JPG, or PNG · up to 8 MB. Uploaded files are sent to Google for this reply; chat history saves the filename and response. Reattach the file for follow-up questions.</p>
        <label className="gemini-free-tier-consent"><input type="checkbox" checked={freeTierAcknowledged} onChange={(event) => setFreeTierAcknowledged(event.target.checked)} disabled={configured !== true || busy} />
          <span>I understand my message, pasted text, and any attached file are sent to Google Gemini’s free-tier API, where Google may use submitted content to improve its products. I will avoid names, IDs, and information I do not want shared with Google.</span>
        </label>
        <p id="assistant-note">Messages and replies are saved encrypted to your account. Shift+Enter for a new line.</p>
      </form>
    </section>
  </div>;
}
