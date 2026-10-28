"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
type Message = { id: string; sequence: number; conversationId: string; senderId: string; senderRole: "Patient" | "Doctor"; senderName: string; body: string; createdAt: string };
type Conversation = { id: string };
type Ack = { success: boolean; data?: { message: Message; duplicate: boolean }; error?: { message: string } };

async function dataOf<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message ?? "Chat could not be loaded.");
  return data.data as T;
}

export function ConsultationChat({ appointmentId }: { appointmentId: string }) {
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState<"Patient" | "Doctor" | "">("");
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [online, setOnline] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<Socket | null>(null);
  const conversationRef = useRef("");
  const pendingRef = useRef<{ body: string; id: string } | null>(null);

  useEffect(() => { conversationRef.current = conversation?.id ?? ""; }, [conversation?.id]);
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [identity, lookup] = await Promise.all([
          fetch(`${apiUrl}/api/v1/auth/me`, { credentials: "include" }),
          fetch(`${apiUrl}/api/v1/chat/appointments/${appointmentId}/conversation`, { credentials: "include" })
        ]);
        const [identityData, lookupData] = await Promise.all([
          dataOf<{ user: { id: string; role: string } }>(identity),
          dataOf<{ conversation: Conversation }>(lookup)
        ]);
        if (!active) return;
        if (identityData.user.role !== "Patient" && identityData.user.role !== "Doctor") throw new Error("Chat is only available to the assigned patient and doctor.");
        setUserId(identityData.user.id);
        setRole(identityData.user.role);
        setConversation(lookupData.conversation);
        const query = new URLSearchParams({ limit: "100", appointmentId });
        const page = await dataOf<{ messages: Message[] }>(await fetch(`${apiUrl}/api/v1/chat/conversations/${lookupData.conversation.id}/messages?${query}`, { credentials: "include" }));
        if (!active) return;
        setMessages(page.messages);
        await fetch(`${apiUrl}/api/v1/chat/conversations/${lookupData.conversation.id}/read?appointmentId=${appointmentId}`, { method: "POST", credentials: "include" });
      } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : "Chat could not be loaded."); }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [appointmentId]);

  useEffect(() => {
    if (!conversation || !userId) return;
    const socket = io(apiUrl, { withCredentials: true });
    socketRef.current = socket;
    socket.on("connect", () => { setOnline(true); socket.emit("conversation:join", { conversationId: conversation.id, appointmentId }); });
    socket.on("disconnect", () => setOnline(false));
    socket.on("connect_error", () => setOnline(false));
    socket.on("message:new", (message: Message) => {
      if (message.conversationId === conversationRef.current) {
        setMessages((current) => current.some((item) => item.id === message.id) ? current : [...current, message].sort((a, b) => a.sequence - b.sequence));
        if (message.senderId !== userId) void fetch(`${apiUrl}/api/v1/chat/conversations/${message.conversationId}/read?appointmentId=${appointmentId}`, { method: "POST", credentials: "include" });
      }
    });
    return () => { socket.disconnect(); socketRef.current = null; };
  }, [appointmentId, conversation, userId]);

  useEffect(() => { if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight; }, [messages]);

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!conversation || !draft.trim()) return;
    const body = draft.trim();
    const clientMessageId = pendingRef.current?.body === body ? pendingRef.current.id : crypto.randomUUID();
    pendingRef.current = { body, id: clientMessageId };
    setSending(true); setError("");
    try {
      const socket = socketRef.current;
      if (socket?.connected) {
        const ack = await new Promise<Ack>((resolve, reject) => socket.timeout(10000).emit("message:send", { conversationId: conversation.id, appointmentId, clientMessageId, message: body }, (cause: Error | null, result: Ack) => cause ? reject(new Error("Message delivery was not acknowledged. Retry safely.")) : resolve(result)));
        if (!ack.success || !ack.data) throw new Error(ack.error?.message ?? "Message could not be sent.");
      } else {
        await dataOf(await fetch(`${apiUrl}/api/v1/chat/conversations/${conversation.id}/messages?appointmentId=${appointmentId}`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientMessageId, message: body }) }));
      }
      pendingRef.current = null; setDraft("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Message could not be sent."); }
    finally { setSending(false); }
  }

  return <section className="consultation-chat" aria-label="In-call chat">
    <header><div><h2>In-call chat</h2><p>Patient ↔ Doctor · private, saved messages</p></div><span className={online ? "connection-state is-online" : "connection-state"}>{online ? "Live" : "Offline"}</span></header>
    {error && <p className="notice notice-error" role="alert">{error}</p>}
    <div className="consultation-chat-history" ref={listRef} aria-live="polite">
      {loading ? <p role="status">Loading chat…</p> : messages.length ? messages.map((message) => <article key={message.id} className={message.senderId === userId ? "message-bubble is-mine" : "message-bubble"}><p>{message.body}</p><footer><span>{message.senderId === userId ? `You · ${role}` : `${message.senderName} · ${message.senderRole}`}</span><time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleTimeString()}</time></footer></article>) : <p className="form-help">No messages yet. Send a message to {role === "Patient" ? "your doctor" : "your patient"}.</p>}
    </div>
    <form className="consultation-chat-composer" onSubmit={(event) => void send(event)}>
      <label className="visually-hidden" htmlFor="consultation-chat-input">Write a chat message</label>
      <textarea id="consultation-chat-input" rows={2} maxLength={4000} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Write a message…" disabled={loading || !conversation} />
      <button className="primary-button" type="submit" disabled={sending || loading || !draft.trim() || !conversation}>{sending ? "Sending…" : "Send"}</button>
    </form>
  </section>;
}
