import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import type { Pool } from "pg";
import { config } from "../config.js";

export type EmailCodePurpose = "verify_email" | "password_reset";

export interface EmailCodeRepository {
  issue(userId: string, purpose: EmailCodePurpose): Promise<string | undefined>;
  consume(userId: string, purpose: EmailCodePurpose, code: string, passwordHash?: string): Promise<boolean>;
}

export function hashEmailCode(code: string, pepper: string): string {
  return createHmac("sha256", Buffer.from(pepper, "hex")).update(code).digest("hex");
}

export function createEmailCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export class PostgresEmailCodeRepository implements EmailCodeRepository {
  constructor(private readonly db: Pool) {}

  async issue(userId: string, purpose: EmailCodePurpose): Promise<string | undefined> {
    const pepper = config.AUTH_OTP_PEPPER;
    if (!pepper) return undefined;
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [userId]);
      const rate = await client.query<{ request_count: number; window_started_at: Date | string }>(
        "SELECT request_count,window_started_at FROM auth_email_delivery_limits WHERE user_id=$1 FOR UPDATE",
        [userId]
      );
      const activeWindow = rate.rows[0] && new Date(rate.rows[0].window_started_at).getTime() > Date.now() - 60 * 60 * 1000;
      if (activeWindow && rate.rows[0]!.request_count >= 5) {
        await client.query("ROLLBACK");
        return undefined;
      }
      await client.query(
        `INSERT INTO auth_email_delivery_limits(user_id,window_started_at,request_count)
         VALUES($1,now(),1)
         ON CONFLICT(user_id) DO UPDATE SET
           window_started_at=CASE WHEN auth_email_delivery_limits.window_started_at<=now()-interval '1 hour' THEN now() ELSE auth_email_delivery_limits.window_started_at END,
           request_count=CASE WHEN auth_email_delivery_limits.window_started_at<=now()-interval '1 hour' THEN 1 ELSE auth_email_delivery_limits.request_count+1 END`,
        [userId]
      );
      await client.query("DELETE FROM auth_email_codes WHERE user_id=$1 AND purpose=$2", [userId, purpose]);
      await client.query("DELETE FROM auth_email_codes WHERE expires_at<=now()");
      const code = createEmailCode();
      await client.query(
        `INSERT INTO auth_email_codes(user_id,purpose,code_hash,expires_at)
         VALUES($1,$2,$3,now()+interval '10 minutes')`,
        [userId, purpose, hashEmailCode(code, pepper)]
      );
      await client.query("COMMIT");
      return code;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  async consume(userId: string, purpose: EmailCodePurpose, code: string, passwordHash?: string): Promise<boolean> {
    const pepper = config.AUTH_OTP_PEPPER;
    if (!pepper) return false;
    const submittedHash = hashEmailCode(code, pepper);
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<{ id: string; code_hash: string }>(
        `SELECT id,code_hash FROM auth_email_codes
         WHERE user_id=$1 AND purpose=$2 AND expires_at>now() AND attempts<5
         ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
        [userId, purpose]
      );
      const entry = result.rows[0];
      if (!entry) { await client.query("ROLLBACK"); return false; }
      const matches = timingSafeEqual(Buffer.from(entry.code_hash, "hex"), Buffer.from(submittedHash, "hex"));
      if (!matches) {
        await client.query("UPDATE auth_email_codes SET attempts=attempts+1 WHERE id=$1", [entry.id]);
        await client.query("COMMIT");
        return false;
      }
      if (purpose === "verify_email") {
        await client.query("UPDATE users SET email_verified=true,updated_at=now() WHERE id=$1", [userId]);
      } else {
        if (!passwordHash) { await client.query("ROLLBACK"); return false; }
        await client.query("UPDATE users SET password_hash=$2,updated_at=now() WHERE id=$1", [userId, passwordHash]);
        await client.query("DELETE FROM auth_sessions WHERE user_id=$1", [userId]);
        await client.query("DELETE FROM auth_mfa_challenges WHERE user_id=$1", [userId]);
      }
      await client.query("DELETE FROM auth_email_codes WHERE user_id=$1 AND purpose=$2", [userId, purpose]);
      await client.query("COMMIT");
      return true;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }
}
