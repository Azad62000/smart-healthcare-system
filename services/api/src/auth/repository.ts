import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import type { Pool } from "pg";

export type UserRole = "Patient" | "Doctor" | "Admin";
export type UserStatus = "active" | "inactive" | "locked";
export interface UserRecord { id: string; email: string; password_hash: string; role: UserRole; status: UserStatus; email_verified?: boolean }
export interface PublicUser { id: string; email: string; role: UserRole; status: UserStatus; email_verified?: boolean }
export interface AuthRepository {
  createPatient(email: string, password: string): Promise<PublicUser>;
  findByEmail(email: string): Promise<UserRecord | undefined>;
  findById(id: string): Promise<PublicUser | undefined>;
  createSession(userId: string, ttlHours: number): Promise<string>;
  findSession(token: string): Promise<PublicUser | undefined>;
  deleteSession(token: string): Promise<void>;
}

export function tokenDigest(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export class PostgresAuthRepository implements AuthRepository {
  constructor(private readonly db: Pool) {}

  async createPatient(email: string, password: string): Promise<PublicUser> {
    const passwordHash = await bcrypt.hash(password, 12);
    const { rows } = await this.db.query<PublicUser>(
      "INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'Patient') RETURNING id, email, role, status, false AS email_verified",
      [email, passwordHash]
    );
    return rows[0]!;
  }

  async findByEmail(email: string): Promise<UserRecord | undefined> {
    const { rows } = await this.db.query<UserRecord>("SELECT id, email, password_hash, role, status, email_verified FROM users WHERE email = $1", [email]);
    return rows[0];
  }

  async findById(id: string): Promise<PublicUser | undefined> {
    const { rows } = await this.db.query<PublicUser>("SELECT id, email, role, status, email_verified FROM users WHERE id = $1", [id]);
    return rows[0];
  }

  async createSession(userId: string, ttlHours: number): Promise<string> {
    const token = randomBytes(32).toString("base64url");
    const result = await this.db.query(
      `INSERT INTO auth_sessions (user_id, token_hash, expires_at, mfa_verified)
       SELECT u.id,$2,now()+($3 * interval '1 hour'),u.role='Admin' FROM users u
       WHERE u.id=$1 AND u.status='active'
         AND (u.role!='Admin' OR EXISTS (SELECT 1 FROM admin_mfa m WHERE m.user_id=u.id AND m.enabled=true))
       RETURNING id`,
      [userId, tokenDigest(token), ttlHours]
    );
    if (result.rowCount !== 1) throw new Error("Admin MFA must be enabled before creating an Admin session.");
    return token;
  }

  async findSession(token: string): Promise<PublicUser | undefined> {
    const { rows } = await this.db.query<PublicUser>(
      `SELECT u.id, u.email, u.role, u.status
       FROM auth_sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.expires_at > now() AND u.status = 'active'
         AND (u.role!='Admin' OR (s.mfa_verified=true AND EXISTS (SELECT 1 FROM admin_mfa m WHERE m.user_id=u.id AND m.enabled=true)))`,
      [tokenDigest(token)]
    );
    return rows[0];
  }

  async deleteSession(token: string): Promise<void> {
    await this.db.query("DELETE FROM auth_sessions WHERE token_hash = $1", [tokenDigest(token)]);
  }
}
