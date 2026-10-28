import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import type { Pool } from "pg";
import type { UserRecord } from "./repository.js";

export type OAuthProvider = "google" | "facebook";
export interface OAuthFlow {
  provider: OAuthProvider;
  nonce: string;
  codeVerifier: string;
}

export interface OAuthRepository {
  createFlow(state: string, flow: OAuthFlow): Promise<void>;
  consumeFlow(state: string, provider: OAuthProvider): Promise<OAuthFlow | undefined>;
  findOrCreateUser(provider: OAuthProvider, subject: string, email: string | undefined, emailVerified: boolean): Promise<UserRecord>;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export class PostgresOAuthRepository implements OAuthRepository {
  constructor(private readonly db: Pool) {}

  async createFlow(state: string, flow: OAuthFlow): Promise<void> {
    await this.db.query("DELETE FROM auth_oauth_flows WHERE expires_at<=now()");
    await this.db.query(
      `INSERT INTO auth_oauth_flows(state_hash,provider,nonce,code_verifier,expires_at)
       VALUES($1,$2,$3,$4,now()+interval '10 minutes')`,
      [hash(state), flow.provider, flow.nonce, flow.codeVerifier]
    );
  }

  async consumeFlow(state: string, provider: OAuthProvider): Promise<OAuthFlow | undefined> {
    const { rows } = await this.db.query<OAuthFlow>(
      `DELETE FROM auth_oauth_flows
       WHERE state_hash=$1 AND provider=$2 AND expires_at>now()
       RETURNING provider,nonce,code_verifier AS "codeVerifier"`,
      [hash(state), provider]
    );
    return rows[0];
  }

  async findOrCreateUser(provider: OAuthProvider, subject: string, email: string | undefined, emailVerified: boolean): Promise<UserRecord> {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const identity = await client.query<UserRecord>(
        `SELECT u.id,u.email,u.password_hash,u.role,u.status,u.email_verified
         FROM auth_identities i JOIN users u ON u.id=i.user_id
         WHERE i.provider=$1 AND i.provider_subject=$2 FOR UPDATE OF u`,
        [provider, subject]
      );
      let user = identity.rows[0];
      if (!user) {
        if (!email || !emailVerified) throw new Error("OAuth provider did not verify the email address.");
        const existing = await client.query<UserRecord>(
          "SELECT id,email,password_hash,role,status,email_verified FROM users WHERE email=$1 FOR UPDATE",
          [email]
        );
        user = existing.rows[0];
        if (user && !user.email_verified) throw new Error("An account with this email must be verified before linking.");
        if (!user) {
          const passwordHash = await bcrypt.hash(randomBytes(32).toString("hex"), 12);
          const created = await client.query<UserRecord>(
            `INSERT INTO users(email,password_hash,role,email_verified)
             VALUES($1,$2,'Patient',true)
             RETURNING id,email,password_hash,role,status,email_verified`,
            [email, passwordHash]
          );
          user = created.rows[0]!;
        }
        await client.query(
          "INSERT INTO auth_identities(user_id,provider,provider_subject) VALUES($1,$2,$3)",
          [user.id, provider, subject]
        );
      }
      await client.query("COMMIT");
      return user;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
