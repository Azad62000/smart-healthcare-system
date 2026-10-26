import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config } from "../src/config.js";
import { PostgresLoginAttemptLimiter } from "../src/auth/login-rate-limiter.js";

const enabled = process.env.RUN_DATABASE_LOGIN_LIMIT_TESTS === "true";
const integration = enabled ? describe : describe.skip;

integration("PostgreSQL login attempt limiting", () => {
  let pool: Pool;
  let limiter: PostgresLoginAttemptLimiter;
  const rateLimitKey = randomUUID();
  const email = `rate-limit-${randomUUID()}@example.test`;
  const sourceAddress = "203.0.113.25";

  beforeAll(async () => {
    const connectionString = process.env.LOGIN_LIMIT_DATABASE_URL ?? config.DATABASE_URL;
    const databaseUrl = new URL(connectionString);
    if (config.NODE_ENV === "production" ||
        !["localhost", "127.0.0.1", "::1"].includes(databaseUrl.hostname) ||
        databaseUrl.pathname !== "/smart_healthcare") {
      throw new Error(`Login limiter DB guard rejected environment=${config.NODE_ENV}, host=${databaseUrl.hostname}, database=${databaseUrl.pathname.slice(1)}.`);
    }
    pool = new Pool({ connectionString });
    limiter = new PostgresLoginAttemptLimiter(pool, rateLimitKey);
  });

  afterAll(async () => {
    if (!pool) return;
    if (limiter) await limiter.clear(email, sourceAddress);
    await pool.end();
  });

  it("shares a short account-and-source window across API instances and clears it after successful credentials", async () => {
    const secondInstance = new PostgresLoginAttemptLimiter(pool, rateLimitKey);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect((await limiter.consume(email, sourceAddress)).allowed).toBe(true);
    }

    const blocked = await secondInstance.consume(email, sourceAddress);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    await secondInstance.clear(email, sourceAddress);
    expect((await limiter.consume(email, sourceAddress)).allowed).toBe(true);
  });
});
