import { createHmac } from "node:crypto";
import type { Pool } from "pg";

export interface LoginAttemptLimiter {
  consume(email: string, sourceAddress: string): Promise<{ allowed: boolean; retryAfterSeconds: number }>;
  clear(email: string, sourceAddress: string): Promise<void>;
}

const maxAttempts = 10;
const windowSeconds = 15 * 60;

export class PostgresLoginAttemptLimiter implements LoginAttemptLimiter {
  private readonly key: Buffer;
  private nextCleanupAt = 0;

  constructor(private readonly db: Pool, keyMaterial: string) {
    this.key = createHmac("sha256", keyMaterial).update("healthcare-login-rate-limit-v1").digest();
  }

  async consume(email: string, sourceAddress: string): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
    if (Date.now() >= this.nextCleanupAt) {
      await this.db.query("DELETE FROM auth_login_attempt_limits WHERE expires_at <= now()");
      this.nextCleanupAt = Date.now() + 60_000;
    }

    const bucketHash = this.bucketHash(email, sourceAddress);
    const { rows } = await this.db.query<{ attempts: number; expires_at: Date | string }>(
      `INSERT INTO auth_login_attempt_limits(bucket_hash, attempts, expires_at)
       VALUES($1, 1, now() + ($2 * interval '1 second'))
       ON CONFLICT(bucket_hash) DO UPDATE SET
         attempts=CASE
           WHEN auth_login_attempt_limits.expires_at <= now() THEN 1
           ELSE LEAST(auth_login_attempt_limits.attempts + 1, $3)
         END,
         expires_at=CASE
           WHEN auth_login_attempt_limits.expires_at <= now() THEN now() + ($2 * interval '1 second')
           ELSE auth_login_attempt_limits.expires_at
         END,
         updated_at=now()
       RETURNING attempts, expires_at`,
      [bucketHash, windowSeconds, maxAttempts + 1]
    );
    const row = rows[0];
    if (!row) throw new Error("Login attempt limit could not be recorded.");
    const retryAfterSeconds = Math.max(1, Math.ceil((new Date(row.expires_at).getTime() - Date.now()) / 1000));
    return { allowed: row.attempts <= maxAttempts, retryAfterSeconds };
  }

  async clear(email: string, sourceAddress: string): Promise<void> {
    await this.db.query("DELETE FROM auth_login_attempt_limits WHERE bucket_hash=$1", [
      this.bucketHash(email, sourceAddress)
    ]);
  }

  private bucketHash(email: string, sourceAddress: string): string {
    return createHmac("sha256", this.key)
      .update("account-and-source\0")
      .update(email.toLowerCase())
      .update("\0")
      .update(sourceAddress)
      .digest("hex");
  }
}
