"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface DashboardLink { href: string; label: string; }

export function DashboardNav({ links, currentPath, label = "Dashboard navigation" }: { links: DashboardLink[]; currentPath: string; label?: string }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function signOut() {
    setError(""); setBusy(true);
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"}/api/v1/auth/logout`, { method: "POST", credentials: "include" });
      if (!response.ok) throw new Error("Could not sign out. Please try again.");
      router.replace("/");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not sign out. Please try again."); }
    finally { setBusy(false); }
  }
  const dashboardHref = currentPath.startsWith("/doctor") ? "/doctor" : currentPath.startsWith("/admin") ? "/admin" : "/patient";
  const isDashboardHome = currentPath === dashboardHref;
  return <nav className="dashboard-nav" aria-label={label}>
    <ul>{!isDashboardHome && <li className="dashboard-back-item"><a className="dashboard-back-link" href={dashboardHref}>← Back to dashboard</a></li>}{links.map(({ href, label: linkLabel }) => <li key={href}><a href={href} aria-current={currentPath === href ? "page" : undefined}>{linkLabel}</a></li>)}<li><button type="button" onClick={() => void signOut()} disabled={busy}>{busy ? "Signing out…" : "Sign out"}</button></li></ul>
    {error && <span role="alert">{error}</span>}
  </nav>;
}
