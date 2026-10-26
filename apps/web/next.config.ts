import type { NextConfig } from "next";

if (process.env.NODE_ENV === "production") {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL;
  let protocol: string | undefined;
  try {
    protocol = apiUrl ? new URL(apiUrl).protocol : undefined;
  } catch {
    protocol = undefined;
  }
  if (protocol !== "https:") {
    throw new Error("Production builds require NEXT_PUBLIC_API_URL to use HTTPS.");
  }
}

const nextConfig: NextConfig = {};
nextConfig.distDir = process.env.NEXT_DIST_DIR ?? ".next";
export default nextConfig;
