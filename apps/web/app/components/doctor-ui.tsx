"use client";

import { ReactNode } from "react";

export function LoadingCard({ children = "Loading…" }: { children?: ReactNode }) {
  return <section className="dashboard-card loading-card" role="status"><span className="spinner" />{children}</section>;
}

export function ErrorNotice({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return <div className="notice notice-error" role="alert"><span>{message}</span>{onRetry && <button type="button" className="text-button" onClick={onRetry}>Retry</button>}</div>;
}

export function EmptyCard({ title, children }: { title: string; children: ReactNode }) {
  return <div className="empty-state compact"><h3>{title}</h3><p>{children}</p></div>;
}
