import { createHash, randomBytes } from "node:crypto";
import type { Pool, PoolClient } from "pg";

export type AdminMfaPurpose = "enroll" | "login";
export interface AdminMfaState { enabled: boolean; secretEncrypted: string | null; pendingSecretEncrypted: string | null; lastTotpStep: number }
export interface AdminMfaChallenge { userId: string; purpose: AdminMfaPurpose; attempts: number }

export interface AdminMfaRepository {
  isEnabled(userId: string): Promise<boolean>;
  createChallenge(userId: string, purpose: AdminMfaPurpose): Promise<string | undefined>;
  isRateLimited(userId: string): Promise<boolean>;
  findChallenge(token: string): Promise<AdminMfaChallenge | undefined>;
  savePendingSecret(userId: string, encryptedSecret: string): Promise<void>;
  getState(userId: string): Promise<AdminMfaState | undefined>;
  recordFailure(token: string): Promise<void>;
  completeEnrollment(token: string, userId: string, encryptedSecret: string, step: number, recoveryHashes: string[]): Promise<boolean>;
  completeTotpLogin(token: string, userId: string, step: number): Promise<boolean>;
  completeRecoveryLogin(token: string, userId: string, recoveryHash: string): Promise<boolean>;
}

function digest(token: string) { return createHash("sha256").update(token).digest("hex"); }

export class PostgresAdminMfaRepository implements AdminMfaRepository {
  constructor(private readonly db: Pool) {}

  async isEnabled(userId: string): Promise<boolean> {
    const result = await this.db.query<{ enabled: boolean }>("SELECT enabled FROM admin_mfa WHERE user_id=$1", [userId]);
    return result.rows[0]?.enabled ?? false;
  }

  async createChallenge(userId: string, purpose: AdminMfaPurpose): Promise<string | undefined> {
    if (await this.isRateLimited(userId)) return undefined;
    await this.db.query("DELETE FROM auth_mfa_challenges WHERE expires_at<=now()");
    const token = randomBytes(32).toString("base64url");
    await this.db.query(
      "INSERT INTO auth_mfa_challenges(token_hash,user_id,purpose,expires_at) VALUES($1,$2,$3,now()+interval '5 minutes')",
      [digest(token), userId, purpose]
    );
    return token;
  }

  async isRateLimited(userId: string): Promise<boolean> {
    const result = await this.db.query<{ locked: boolean }>(
      "SELECT locked_until>now() AS locked FROM admin_mfa_rate_limits WHERE user_id=$1",
      [userId]
    );
    return result.rows[0]?.locked ?? false;
  }

  async findChallenge(token: string): Promise<AdminMfaChallenge | undefined> {
    const result = await this.db.query<{ user_id: string; purpose: AdminMfaPurpose; attempts: number }>(
      "SELECT user_id,purpose,attempts FROM auth_mfa_challenges WHERE token_hash=$1 AND expires_at>now() AND attempts<5",
      [digest(token)]
    );
    const row = result.rows[0];
    return row && { userId: row.user_id, purpose: row.purpose, attempts: row.attempts };
  }

  async savePendingSecret(userId: string, encryptedSecret: string): Promise<void> {
    await this.db.query(
      `INSERT INTO admin_mfa(user_id,pending_secret_encrypted) VALUES($1,$2)
       ON CONFLICT(user_id) DO UPDATE SET pending_secret_encrypted=EXCLUDED.pending_secret_encrypted
       WHERE admin_mfa.enabled=false`,
      [userId, encryptedSecret]
    );
  }

  async getState(userId: string): Promise<AdminMfaState | undefined> {
    const result = await this.db.query<{ enabled: boolean; secret_encrypted: string | null; pending_secret_encrypted: string | null; last_totp_step: string }>(
      "SELECT enabled,secret_encrypted,pending_secret_encrypted,last_totp_step FROM admin_mfa WHERE user_id=$1",
      [userId]
    );
    const row = result.rows[0];
    return row && {
      enabled: row.enabled,
      secretEncrypted: row.secret_encrypted,
      pendingSecretEncrypted: row.pending_secret_encrypted,
      lastTotpStep: Number(row.last_totp_step)
    };
  }

  async recordFailure(token: string): Promise<void> {
    await this.db.query(
      `WITH failed AS (
         UPDATE auth_mfa_challenges SET attempts=attempts+1
         WHERE token_hash=$1 AND expires_at>now() AND attempts<5
         RETURNING user_id
       )
       INSERT INTO admin_mfa_rate_limits(user_id,window_started_at,failure_count,locked_until)
       SELECT user_id,now(),1,NULL FROM failed
       ON CONFLICT(user_id) DO UPDATE SET
         window_started_at=CASE WHEN admin_mfa_rate_limits.window_started_at<=now()-interval '15 minutes' THEN now() ELSE admin_mfa_rate_limits.window_started_at END,
         failure_count=CASE WHEN admin_mfa_rate_limits.window_started_at<=now()-interval '15 minutes' THEN 1 ELSE admin_mfa_rate_limits.failure_count+1 END,
         locked_until=CASE
           WHEN (CASE WHEN admin_mfa_rate_limits.window_started_at<=now()-interval '15 minutes' THEN 1 ELSE admin_mfa_rate_limits.failure_count+1 END)>=10
             THEN now()+interval '15 minutes'
           ELSE admin_mfa_rate_limits.locked_until
         END`,
      [digest(token)]
    );
    await this.db.query("DELETE FROM auth_mfa_challenges WHERE token_hash=$1 AND attempts>=5", [digest(token)]);
  }

  async completeEnrollment(token: string, userId: string, encryptedSecret: string, step: number, recoveryHashes: string[]): Promise<boolean> {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const challenge = await lockChallenge(client, token, userId, "enroll");
      if (!challenge) { await client.query("ROLLBACK"); return false; }
      const enabled = await client.query(
        `INSERT INTO admin_mfa(user_id,secret_encrypted,pending_secret_encrypted,enabled,last_totp_step)
         VALUES($1,$2,NULL,true,$3)
         ON CONFLICT(user_id) DO UPDATE SET secret_encrypted=EXCLUDED.secret_encrypted,
           pending_secret_encrypted=NULL,enabled=true,last_totp_step=EXCLUDED.last_totp_step
         WHERE admin_mfa.enabled=false RETURNING user_id`,
        [userId, encryptedSecret, step]
      );
      if (enabled.rowCount !== 1) { await client.query("ROLLBACK"); return false; }
      await client.query("DELETE FROM admin_mfa_recovery_codes WHERE user_id=$1", [userId]);
      for (const codeHash of recoveryHashes) {
        await client.query("INSERT INTO admin_mfa_recovery_codes(user_id,code_hash) VALUES($1,$2)", [userId, codeHash]);
      }
      await client.query("DELETE FROM admin_mfa_rate_limits WHERE user_id=$1", [userId]);
      await client.query("DELETE FROM auth_mfa_challenges WHERE token_hash=$1", [digest(token)]);
      await client.query("COMMIT");
      return true;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  async completeTotpLogin(token: string, userId: string, step: number): Promise<boolean> {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      if (!await lockChallenge(client, token, userId, "login")) { await client.query("ROLLBACK"); return false; }
      const updated = await client.query(
        "UPDATE admin_mfa SET last_totp_step=$2 WHERE user_id=$1 AND enabled=true AND last_totp_step<$2",
        [userId, step]
      );
      if (updated.rowCount !== 1) { await client.query("ROLLBACK"); return false; }
      await client.query("DELETE FROM admin_mfa_rate_limits WHERE user_id=$1", [userId]);
      await client.query("DELETE FROM auth_mfa_challenges WHERE token_hash=$1", [digest(token)]);
      await client.query("COMMIT");
      return true;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  async completeRecoveryLogin(token: string, userId: string, recoveryHash: string): Promise<boolean> {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      if (!await lockChallenge(client, token, userId, "login")) { await client.query("ROLLBACK"); return false; }
      const deleted = await client.query(
        "DELETE FROM admin_mfa_recovery_codes WHERE user_id=$1 AND code_hash=$2",
        [userId, recoveryHash]
      );
      if (deleted.rowCount !== 1) { await client.query("ROLLBACK"); return false; }
      await client.query("DELETE FROM admin_mfa_rate_limits WHERE user_id=$1", [userId]);
      await client.query("DELETE FROM auth_mfa_challenges WHERE token_hash=$1", [digest(token)]);
      await client.query("COMMIT");
      return true;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }
}

async function lockChallenge(client: PoolClient, token: string, userId: string, purpose: AdminMfaPurpose): Promise<boolean> {
  const result = await client.query(
    `SELECT token_hash FROM auth_mfa_challenges
     WHERE token_hash=$1 AND user_id=$2 AND purpose=$3 AND expires_at>now() AND attempts<5 FOR UPDATE`,
    [digest(token), userId, purpose]
  );
  return result.rowCount === 1;
}
