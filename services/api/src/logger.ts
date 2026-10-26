import { config } from "./config.js";

type LogLevel = "debug" | "info" | "warn" | "error";
type SafeFields = Readonly<{ requestId?: string; method?: string; path?: string; statusCode?: number; durationMs?: number }>;

const priorities: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** Structured allowlist logger. Callers cannot add arbitrary payloads or sensitive fields. */
export function log(level: LogLevel, event: string, fields: SafeFields = {}): void {
  if (priorities[level] < priorities[config.LOG_LEVEL]) return;
  const record: Record<string, string | number> = {
    timestamp: new Date().toISOString(),
    level,
    event: event.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80),
    ...(fields.requestId && { requestId: fields.requestId }),
    ...(fields.method && { method: fields.method.slice(0, 12) }),
    ...(fields.path && { path: fields.path.split("?")[0].slice(0, 200) }),
    ...(Number.isInteger(fields.statusCode) ? { statusCode: fields.statusCode! } : {}),
    ...(Number.isFinite(fields.durationMs) ? { durationMs: Math.max(0, Math.round(fields.durationMs!)) } : {})
  };
  const serialized = JSON.stringify(record);
  if (level === "error") console.error(serialized);
  else if (level === "warn") console.warn(serialized);
  else console.log(serialized);
}
