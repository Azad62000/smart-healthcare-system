"use client";

import { useEffect, useState } from "react";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
type Role = "Patient" | "Doctor" | "Admin";

export function DashboardBackLink() {
  const [href, setHref] = useState("");
  useEffect(() => {
    let active = true;
    void fetch(`${apiUrl}/api/v1/auth/me`, { credentials: "include" })
      .then(async (response) => response.ok ? response.json() : null)
      .then((body) => {
        const role = body?.data?.user?.role as Role | undefined;
        if (active && role && ["Patient", "Doctor", "Admin"].includes(role)) {
          setHref(role === "Doctor" ? "/doctor" : role === "Admin" ? "/admin" : "/patient");
        }
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);
  return href ? <a className="dashboard-back-link public-dashboard-back" href={href}>← Back to dashboard</a> : null;
}
