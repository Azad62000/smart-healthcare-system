"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { DashboardNav } from "./dashboard-nav";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type UserRole = "Patient" | "Doctor" | "Admin";
type Message = {
  id: string;
  sequence: number;
  conversationId: string;
  senderId: string;
  senderRole: "Patient" | "Doctor";
  senderName: string;
  body: string;
  createdAt: string;
};
type Conversation = {
  id: string;
  participantId: string;
  participantName: string;
  specialization: string;
  lastMessage: Message | null;
  unreadCount: number;
};
type ApiMessagePage = { messages: Message[]; nextCursor: number | null; hasMore: boolean };
type SocketAck = { success: boolean; data?: { message: Message; duplicate: boolean }; error?: { message: string } };

async function responseData<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error?.message ?? "Messaging request failed.");
  return body.data as T;
}

export function MessagingWorkspace({ expectedRole }: { expectedRole: "Patient" | "Doctor" }) {
  const isPatient = expectedRole === "Patient";
  const dashboardPath = isPatient ? "/patient" : "/doctor";
  const messagesPath = `${dashboardPath}/messages`;
  const links = isPatient
    ? [{ href: "/patient", label: "Overview" }, { href: "/patient/appointments", label: "Appointments" }, { href: "/patient/records", label: "Health records" }, { href: "/patient/prescriptions", label: "Prescriptions" }]
    : [{ href: "/doctor", label: "Overview" }, { href: "/doctor/prescriptions", label: "Prescriptions" }];

  const [userId, setUserId] = useState("");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [historyCursor, setHistoryCursor] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [online, setOnline] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const socketRef = useRef<Socket | null>(null);
  const selectedRef = useRef("");
  const conversationsRef = useRef<Conversation[]>([]);
  const pendingSendRef = useRef<{ body: string; clientMessageId: string } | null>(null);
  const reloadHistoryRef = useRef<(conversationId: string) => void>(() => {});

  useEffect(() => { selectedRef.current = selectedId; }, [selectedId]);
  useEffect(() => { conversationsRef.current = conversations; }, [conversations]);

  const mergeMessage = useCallback((message: Message) => {
    if (selectedRef.current === message.conversationId) {
      setMessages((current) => current.some((item) => item.id === message.id)
        ? current
        : [...current, message].sort((left, right) => left.sequence - right.sequence));
    }
    setConversations((current) => current.map((conversation) => {
      if (conversation.id !== message.conversationId) return conversation;
      const isCurrent = selectedRef.current === message.conversationId;
      return {
        ...conversation,
        lastMessage: message,
        unreadCount: isCurrent || message.senderId === userId ? conversation.unreadCount : conversation.unreadCount + 1
      };
    }));
  }, [userId]);

  const loadConversations = useCallback(async () => {
    const response = await fetch(`${apiUrl}/api/v1/chat/conversations`, { credentials: "include" });
    const data = await responseData<{ conversations: Conversation[] }>(response);
    setConversations(data.conversations);
    conversationsRef.current = data.conversations;
    return data.conversations;
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [identityResponse, conversationResponse] = await Promise.all([
          fetch(`${apiUrl}/api/v1/auth/me`, { credentials: "include" }),
          fetch(`${apiUrl}/api/v1/chat/conversations`, { credentials: "include" })
        ]);
        const [identity, data] = await Promise.all([
          responseData<{ user: { id: string; role: UserRole } }>(identityResponse),
          responseData<{ conversations: Conversation[] }>(conversationResponse)
        ]);
        if (!active) return;
        if (identity.user.role !== expectedRole) throw new Error("This messaging workspace is not available for your account.");
        setUserId(identity.user.id);
        setConversations(data.conversations);
        conversationsRef.current = data.conversations;
        const requested = new URLSearchParams(window.location.search).get("conversationId");
        const selection = requested && data.conversations.some((item) => item.id === requested)
          ? requested
          : data.conversations[0]?.id ?? "";
        setSelectedId(selection);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "Unable to load conversations.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [expectedRole]);

  useEffect(() => {
    if (!userId) return;
    const socket = io(apiUrl, { withCredentials: true, autoConnect: true });
    socketRef.current = socket;
    let connectedBefore = false;
    socket.on("connect", () => {
      setOnline(true);
      setError("");
      for (const conversation of conversationsRef.current) {
        socket.emit("conversation:join", { conversationId: conversation.id }, (ack: SocketAck) => {
          if (!ack.success && selectedRef.current === conversation.id) setError(ack.error?.message ?? "Conversation access was denied.");
        });
      }
      if (connectedBefore) {
        void loadConversations().then((loaded) => {
          if (!socket.connected) return;
          for (const conversation of loaded) socket.emit("conversation:join", { conversationId: conversation.id });
          if (selectedRef.current) reloadHistoryRef.current(selectedRef.current);
        }).catch((cause) => setError(cause instanceof Error ? cause.message : "Conversations could not be refreshed after reconnecting."));
      }
      connectedBefore = true;
    });
    socket.on("disconnect", () => setOnline(false));
    socket.on("connect_error", () => setOnline(false));
    socket.on("message:new", (message: Message) => {
      mergeMessage(message);
      if (selectedRef.current === message.conversationId && message.senderId !== userId) {
        void fetch(`${apiUrl}/api/v1/chat/conversations/${message.conversationId}/read`, { method: "POST", credentials: "include" })
          .then(responseData<{ lastReadSequence: number }>)
          .then(() => setConversations((current) => current.map((conversation) => conversation.id === message.conversationId ? { ...conversation, unreadCount: 0 } : conversation)))
          .catch((cause) => setError(cause instanceof Error ? cause.message : "Read status could not be updated."));
      }
    });
    socket.on("conversation:read", ({ conversationId, userId: readerId }: { conversationId: string; userId: string }) => {
      if (readerId === userId) setConversations((current) => current.map((conversation) => conversation.id === conversationId ? { ...conversation, unreadCount: 0 } : conversation));
    });
    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [loadConversations, mergeMessage, userId]);

  const loadHistory = useCallback(async (conversationId: string, before?: number) => {
    setHistoryLoading(true);
    setError("");
    try {
      const query = new URLSearchParams({ limit: "50" });
      if (before) query.set("before", String(before));
      const response = await fetch(`${apiUrl}/api/v1/chat/conversations/${conversationId}/messages?${query}`, { credentials: "include" });
      const page = await responseData<ApiMessagePage>(response);
      if (selectedRef.current === conversationId) {
        setMessages((current) => before
          ? [...page.messages, ...current.filter((message) => !page.messages.some((older) => older.id === message.id))]
          : page.messages);
        setHistoryCursor(page.nextCursor);
        setHasMore(page.hasMore);
      }
      if (!before) {
        const readResponse = await fetch(`${apiUrl}/api/v1/chat/conversations/${conversationId}/read`, { method: "POST", credentials: "include" });
        await responseData<{ lastReadSequence: number }>(readResponse);
        setConversations((current) => current.map((conversation) => conversation.id === conversationId ? { ...conversation, unreadCount: 0 } : conversation));
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Conversation history could not be loaded.");
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => { reloadHistoryRef.current = (conversationId) => { void loadHistory(conversationId); }; }, [loadHistory]);

  useEffect(() => {
    if (!selectedId) { setMessages([]); return; }
    setMessages([]);
    setHistoryCursor(null);
    setHasMore(false);
    if (socketRef.current?.connected) {
      socketRef.current.emit("conversation:join", { conversationId: selectedId }, (ack: SocketAck) => {
        if (!ack.success) setError(ack.error?.message ?? "Conversation access was denied.");
      });
    }
    void loadHistory(selectedId);
  }, [loadHistory, selectedId]);

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedId || !draft.trim()) return;
    setSending(true);
    setError("");
    setNotice("");
    const message = draft.trim();
    const clientMessageId = pendingSendRef.current?.body === message
      ? pendingSendRef.current.clientMessageId
      : crypto.randomUUID();
    pendingSendRef.current = { body: message, clientMessageId };
    try {
      const socket = socketRef.current;
      if (socket?.connected) {
        const ack = await new Promise<SocketAck>((resolve, reject) => {
          socket.timeout(10_000).emit("message:send", { conversationId: selectedId, clientMessageId, message }, (cause: Error | null, result: SocketAck) => {
            if (cause) reject(new Error("Message delivery was not acknowledged. Retry safely; duplicate sends are prevented."));
            else resolve(result);
          });
        });
        if (!ack.success || !ack.data) throw new Error(ack.error?.message ?? "Message could not be sent.");
        mergeMessage(ack.data.message);
      } else {
        const response = await fetch(`${apiUrl}/api/v1/chat/conversations/${selectedId}/messages`, {
          method: "POST", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clientMessageId, message })
        });
        const result = await responseData<{ message: Message }>(response);
        mergeMessage(result.message);
      }
      pendingSendRef.current = null;
      setDraft("");
      setNotice("Message delivered.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Message could not be sent.");
    } finally {
      setSending(false);
    }
  }

  const selected = conversations.find((conversation) => conversation.id === selectedId);
  return <main className="patient-dashboard messaging-page">
    <DashboardNav currentPath={messagesPath} links={links} />
    <header className="dashboard-heading"><div><p className="eyebrow">CARE TEAM</p><h1>Messages</h1><p>Private messages between you and your care team.</p></div></header>
    {!online && !loading && <p className="notice notice-info" role="status">You are offline. Conversation history remains available; messages will use the secure API fallback.</p>}
    {error && <p className="notice notice-error" role="alert">{error}</p>}
    {notice && <p className="notice notice-success" role="status">{notice}</p>}
    {loading ? <section className="dashboard-card loading-card" role="status">Loading conversations…</section> : <section className="dashboard-card messaging-layout">
      <aside className="conversation-sidebar" aria-label="Conversations">
        <h2>Your conversations</h2>
        {conversations.length === 0
          ? <p className="form-help">Conversations become available after you have a confirmed or completed appointment with a care provider.</p>
          : <ul>{conversations.map((conversation) => <li key={conversation.id}>
            <button type="button" className={selectedId === conversation.id ? "conversation-select is-selected" : "conversation-select"} onClick={() => setSelectedId(conversation.id)} aria-current={selectedId === conversation.id ? "true" : undefined}>
              <strong>{isPatient ? "Dr. " : ""}{conversation.participantName}</strong>
              <span>{isPatient ? conversation.specialization : "Patient conversation"}</span>
              <small>{conversation.lastMessage?.body ?? "No messages yet"}</small>
              {conversation.unreadCount > 0 && <em aria-label={`${conversation.unreadCount} unread messages`}>{conversation.unreadCount}</em>}
            </button>
          </li>)}</ul>}
      </aside>
      <section className="message-thread" aria-label="Message history">
        {!selected
          ? <div className="chat-empty"><h2>Select a conversation</h2><p>Choose a care-team conversation to view messages.</p></div>
          : <>
            <header className="message-thread-header"><div><h2>{isPatient ? "Dr. " : ""}{selected.participantName}</h2><p>{isPatient ? selected.specialization : "Private care-team conversation"}</p></div><span className={online ? "connection-state is-online" : "connection-state"}>{online ? "Live" : "Offline"}</span></header>
            {hasMore && <button type="button" className="text-button older-messages" disabled={historyLoading} onClick={() => historyCursor && void loadHistory(selected.id, historyCursor)}>{historyLoading ? "Loading…" : "Load older messages"}</button>}
            <div className="message-history" aria-live="polite">
              {historyLoading && messages.length === 0 && <p role="status">Loading message history…</p>}
              {!historyLoading && messages.length === 0 && <div className="chat-empty"><h3>Start a conversation</h3><p>Messages are private to the assigned Patient and Doctor and remain available after appointments.</p></div>}
              {messages.map((message) => <article key={message.id} className={message.senderId === userId ? "message-bubble is-mine" : "message-bubble"}>
                <p>{message.body}</p><footer><span>{message.senderId === userId ? "You" : message.senderName}</span><time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleString()}</time></footer>
              </article>)}
            </div>
            <form className="message-composer" onSubmit={(event) => void sendMessage(event)}>
              <label htmlFor="message-compose">Message</label>
              <textarea id="message-compose" value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={4000} rows={3} required placeholder="Write a private message…" />
              <div><small>Do not use messaging for emergencies.</small><button className="primary-button" type="submit" disabled={sending || !draft.trim()}>{sending ? "Sending…" : "Send message"}</button></div>
            </form>
          </>}
      </section>
    </section>}
  </main>;
}
