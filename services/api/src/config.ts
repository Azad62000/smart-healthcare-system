import dotenv from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { parseMedicalDataKeys } from "./medical-data-crypto.js";

const optionalString = z.preprocess((value) => value === "" ? undefined : value, z.string().optional());

// Workspace commands run with services/api as their working directory. Resolve
// the shared environment file from this module so the documented root .env is
// loaded consistently for dev, tests, builds, and local database scripts.
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_HOST: z.string().trim().min(1).default("localhost"),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  WEB_ORIGIN: z.string().url().default("http://localhost:3000"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  DATABASE_URL: z.string().url(),
  SESSION_COOKIE_SECURE: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(12),
  MEDICAL_DATA_ENCRYPTION_KEYS: z.string().min(1),
  ADMIN_MFA_ENCRYPTION_KEY: z.preprocess((value) => value === "" ? undefined : value, z.string().regex(/^[a-fA-F0-9]{64}$/).optional()),
  AUTH_OTP_PEPPER: z.preprocess((value) => value === "" ? undefined : value, z.string().regex(/^[a-fA-F0-9]{64}$/).optional()),
  TRUSTED_PROXY_ADDRESSES: z.preprocess((value) => value === "" ? undefined : value, z.string().trim().min(1).optional())
    .transform((value) => value?.split(",").map((address) => address.trim()) ?? [])
    .refine((addresses) => addresses.every((address) => address.length > 0 && address !== "*")),
  API_PUBLIC_URL: z.preprocess((value) => value === "" ? undefined : value, z.string().url().optional()),
  SMTP_HOST: z.preprocess((value) => value === "" ? undefined : value, z.string().trim().min(1).optional()),
  SMTP_PORT: z.preprocess((value) => value === "" ? undefined : value, z.coerce.number().int().min(1).max(65535).optional()),
  SMTP_SECURE: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  SMTP_USER: optionalString,
  SMTP_PASSWORD: optionalString,
  SMTP_FROM: z.preprocess((value) => value === "" ? undefined : value, z.string().email().optional()),
  GOOGLE_CLIENT_ID: optionalString,
  GOOGLE_CLIENT_SECRET: optionalString,
  APPLE_CLIENT_ID: optionalString,
  APPLE_TEAM_ID: optionalString,
  APPLE_KEY_ID: optionalString,
  APPLE_PRIVATE_KEY: optionalString,
  LIVEKIT_URL: z.preprocess((value) => value === "" ? undefined : value, z.string().url().optional()),
  LIVEKIT_API_KEY: optionalString,
  LIVEKIT_API_SECRET: optionalString,
  TELECONSULTATION_JOIN_WINDOW_MINUTES: z.coerce.number().int().min(0).max(120).default(15),
  DOCTOR_RECOMMENDATIONS_ENABLED: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  DOCUMENT_STORAGE_DIR: z.preprocess((value) => value === "" ? undefined : value, z.string().trim().min(1).optional()),
  DOCUMENT_MAX_BYTES: z.coerce.number().int().min(1_048_576).max(25_000_000).default(10_000_000)
}).strict().superRefine((value, context) => {
  try {
    parseMedicalDataKeys(value.MEDICAL_DATA_ENCRYPTION_KEYS);
  } catch {
    context.addIssue({
      code: "custom",
      path: ["MEDICAL_DATA_ENCRYPTION_KEYS"],
      message: "Provide one or more unique key IDs paired with 32-byte hexadecimal keys."
    });
  }
  if (value.NODE_ENV === "production") {
    if (!value.SESSION_COOKIE_SECURE) context.addIssue({ code: "custom", path: ["SESSION_COOKIE_SECURE"], message: "Secure session cookies are required in production." });
    if (!value.API_PUBLIC_URL?.startsWith("https://")) context.addIssue({ code: "custom", path: ["API_PUBLIC_URL"], message: "A public HTTPS API URL is required in production." });
    if (!value.WEB_ORIGIN.startsWith("https://")) context.addIssue({ code: "custom", path: ["WEB_ORIGIN"], message: "The web origin must use HTTPS in production." });
    if (value.LIVEKIT_URL && !value.LIVEKIT_URL.startsWith("wss://")) context.addIssue({ code: "custom", path: ["LIVEKIT_URL"], message: "LiveKit must use WSS in production." });
  }
});

const environmentKeys = ["NODE_ENV", "API_HOST", "API_PORT", "WEB_ORIGIN", "LOG_LEVEL", "DATABASE_URL", "SESSION_COOKIE_SECURE", "SESSION_TTL_HOURS", "MEDICAL_DATA_ENCRYPTION_KEYS", "ADMIN_MFA_ENCRYPTION_KEY", "AUTH_OTP_PEPPER", "TRUSTED_PROXY_ADDRESSES", "API_PUBLIC_URL", "SMTP_HOST", "SMTP_PORT", "SMTP_SECURE", "SMTP_USER", "SMTP_PASSWORD", "SMTP_FROM", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "APPLE_CLIENT_ID", "APPLE_TEAM_ID", "APPLE_KEY_ID", "APPLE_PRIVATE_KEY", "LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET", "TELECONSULTATION_JOIN_WINDOW_MINUTES", "DOCTOR_RECOMMENDATIONS_ENABLED", "DOCUMENT_STORAGE_DIR", "DOCUMENT_MAX_BYTES"] as const;

function applicationEnvironment(environment: NodeJS.ProcessEnv) {
  return Object.fromEntries(environmentKeys.flatMap((key) => environment[key] === undefined ? [] : [[key, environment[key]]]));
}

const parsed = environmentSchema.safeParse(applicationEnvironment(process.env));
if (!parsed.success) {
  throw new Error(`Invalid environment configuration: ${parsed.error.issues.map((issue) => issue.path.join(".")).join(", ")}`);
}
if (parsed.data.NODE_ENV === "production" && !parsed.data.ADMIN_MFA_ENCRYPTION_KEY) {
  throw new Error("Invalid environment configuration: ADMIN_MFA_ENCRYPTION_KEY is required in production.");
}
if (parsed.data.NODE_ENV === "production" && !parsed.data.AUTH_OTP_PEPPER) {
  throw new Error("Invalid environment configuration: AUTH_OTP_PEPPER is required in production.");
}
if (parsed.data.NODE_ENV === "production" && (!parsed.data.SESSION_COOKIE_SECURE || !parsed.data.API_PUBLIC_URL?.startsWith("https://") || !parsed.data.WEB_ORIGIN.startsWith("https://"))) {
  throw new Error("Invalid environment configuration: production requires secure cookies and HTTPS API and web URLs.");
}
if (parsed.data.NODE_ENV === "production" && (!parsed.data.SMTP_HOST || !parsed.data.SMTP_PORT || !parsed.data.SMTP_FROM)) {
  throw new Error("Invalid environment configuration: SMTP_HOST, SMTP_PORT, and SMTP_FROM are required in production.");
}
if (Boolean(parsed.data.SMTP_USER) !== Boolean(parsed.data.SMTP_PASSWORD)) {
  throw new Error("Invalid environment configuration: SMTP_USER and SMTP_PASSWORD must be configured together.");
}
if (Boolean(parsed.data.GOOGLE_CLIENT_ID) !== Boolean(parsed.data.GOOGLE_CLIENT_SECRET)) {
  throw new Error("Invalid environment configuration: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be configured together.");
}
const appleConfig = [parsed.data.APPLE_CLIENT_ID, parsed.data.APPLE_TEAM_ID, parsed.data.APPLE_KEY_ID, parsed.data.APPLE_PRIVATE_KEY];
if (appleConfig.some(Boolean) && !appleConfig.every(Boolean)) {
  throw new Error("Invalid environment configuration: all Apple OAuth settings must be configured together.");
}
if (parsed.data.NODE_ENV === "production" && (appleConfig.some(Boolean) || parsed.data.GOOGLE_CLIENT_ID)) {
  if (!parsed.data.API_PUBLIC_URL || !parsed.data.API_PUBLIC_URL.startsWith("https://")) {
    throw new Error("Invalid environment configuration: API_PUBLIC_URL must use HTTPS when OAuth is enabled in production.");
  }
  const livekitConfig = [parsed.data.LIVEKIT_URL, parsed.data.LIVEKIT_API_KEY, parsed.data.LIVEKIT_API_SECRET];
  if (livekitConfig.some(Boolean) && !livekitConfig.every(Boolean)) {
    throw new Error("Invalid environment configuration: LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET must be configured together.");
  }
}

export const config = parsed.data;

export function parseEnvironment(environment: NodeJS.ProcessEnv) {
  return environmentSchema.safeParse(applicationEnvironment(environment));
}
