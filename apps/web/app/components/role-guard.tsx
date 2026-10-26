"use client";

import { ReactNode, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

function expectedRoleForPath(pathname: string): string | undefined {
  if (pathname === "/patient" || pathname.startsWith("/patient/")) return "Patient";
  if (pathname === "/doctor" || pathname.startsWith("/doctor/")) return "Doctor";
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return "Admin";
  if (pathname === "/ai" || pathname.startsWith("/ai/") || pathname === "/chat") return "Patient";
  return undefined;
}

export function RoleGuard({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [allowed, setAllowed] = useState(false);
  useEffect(() => {
    const expectedRole = expectedRoleForPath(pathname);
    if (!expectedRole) { setAllowed(true); return; }
    fetch(`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"}/api/v1/auth/me`, { credentials: "include" })
      .then(async (response) => {
        if (!response.ok) throw new Error("unauthenticated");
        const body = await response.json();
        const role = body.data.user.role as string;
        if (role !== expectedRole) {
          const target: Record<string, string> = { Patient: "/patient", Doctor: "/doctor", Admin: "/admin" };
          router.replace(target[role] ?? "/");
          return;
        }
        setAllowed(true);
      })
      .catch(() => router.replace("/"));
  }, [pathname, router]);
  if (!allowed) return <main aria-live="polite">Checking your session…</main>;
  return children;
}
