import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import "@livekit/components-styles";
import { RoleGuard } from "./components/role-guard";

export const metadata: Metadata = { title: "Smart Healthcare", description: "Healthcare services workspace" };

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <html lang="en"><body><RoleGuard>{children}</RoleGuard></body></html>;
}
