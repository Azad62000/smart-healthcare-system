"use client";

import { useCallback, useEffect, useState } from "react";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
type Notification = { id: string; eventType: string; appointmentId: string; title: string; message: string; createdAt: string; readAt: string | null };

export function Notifications() {
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const unread = items.filter((item) => !item.readAt).length;

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`${apiUrl}/api/v1/notifications/me`, { credentials: "include" });
      if (!response.ok) throw new Error("Notifications could not be loaded.");
      const body = await response.json();
      setItems(Array.isArray(body.data?.notifications) ? body.data.notifications as Notification[] : []);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Notifications could not be loaded."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function markRead(id: string) {
    setError("");
    try {
      const response = await fetch(`${apiUrl}/api/v1/notifications/${id}/read`, { method: "PATCH", credentials: "include" });
      if (!response.ok) throw new Error("Notification could not be marked as read.");
      const body = await response.json();
      const updated = body.data.notification as Notification;
      setItems((current) => current.map((item) => item.id === id ? updated : item));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Notification could not be marked as read."); }
  }

  return <section className="dashboard-card notification-card" aria-labelledby="notifications-heading">
    <div className="card-heading"><div><p className="eyebrow">UPDATES</p><h2 id="notifications-heading">Notifications <span className="notification-count" aria-label={`${unread} unread`}>{unread}</span></h2></div><button className="text-button" type="button" onClick={() => void load()}>Refresh</button></div>
    {error && <p role="alert" className="notification-error">{error}</p>}
    {loading ? <p role="status">Loading notifications…</p> : items.length === 0 ? <p className="notification-empty">You’re all caught up. Appointment updates will appear here.</p> : <ul className="notification-list">{items.map((item) => <li key={item.id} className={item.readAt ? "notification-read" : "notification-unread"}><div><strong>{item.title}</strong><p>{item.message}</p><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString()}</time></div>{!item.readAt && <button type="button" className="secondary-button" onClick={() => void markRead(item.id)}>Mark read</button>}</li>)}</ul>}
  </section>;
}
