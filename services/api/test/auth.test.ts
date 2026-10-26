import { beforeEach, describe, expect, it } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import type { Response } from "supertest";
import type { AuthRepository, PublicUser, UserRecord } from "../src/auth/repository.js";
import { createAuthRouter, sessionCookieName } from "../src/auth/routes.js";
import { requireAuthenticated, requireResourceOwner, requireRoles } from "../src/auth/authorization.js";
import type { AdminMfaChallenge, AdminMfaPurpose, AdminMfaRepository, AdminMfaState } from "../src/auth/admin-mfa-repository.js";
import { createTotpCode, verifyTotpCode } from "../src/auth/totp.js";
import { errorHandler } from "../src/middleware/error-handler.js";
import { requestIdMiddleware } from "../src/middleware/request-id.js";
import type { EmailCodePurpose, EmailCodeRepository } from "../src/auth/email-code-repository.js";
import type { LoginAttemptLimiter } from "../src/auth/login-rate-limiter.js";

class MemoryAuthRepository implements AuthRepository {
  users: UserRecord[] = [];
  sessions = new Map<string, string>();
  async createPatient(email: string, password: string): Promise<PublicUser> {
    if (this.users.some((user) => user.email === email)) throw Object.assign(new Error("duplicate"), { code: "23505" });
    const bcrypt = await import("bcryptjs");
    const user: UserRecord = { id: `user-${this.users.length + 1}`, email, password_hash: await bcrypt.hash(password, 4), role: "Patient", status: "active", email_verified: false };
    this.users.push(user);
    return { id: user.id, email, role: user.role, status: user.status };
  }
  async findByEmail(email: string) { return this.users.find((user) => user.email === email); }
  async findById(id: string) { const user = this.users.find((entry) => entry.id === id); return user && { id: user.id, email: user.email, role: user.role, status: user.status }; }
  async createSession(userId: string, _ttlHours?: number) { const token = `opaque-session-${Math.random()}`; this.sessions.set(token, userId); return token; }
  async findSession(token: string) { const user = this.users.find((entry) => entry.id === this.sessions.get(token) && entry.status === "active"); return user && { id: user.id, email: user.email, role: user.role, status: user.status }; }
  async deleteSession(token: string) { this.sessions.delete(token); }
}

class MemoryEmailCodeRepository implements EmailCodeRepository {
  constructor(private readonly auth: MemoryAuthRepository) {}
  async issue(_userId: string, _purpose: EmailCodePurpose) { return "123456"; }
  async consume(userId: string, purpose: EmailCodePurpose, code: string, passwordHash?: string) {
    const user = this.auth.users.find((entry) => entry.id === userId);
    if (!user || code !== "123456") return false;
    if (purpose === "verify_email") user.email_verified = true;
    else {
      if (!passwordHash) return false;
      user.password_hash = passwordHash;
      for (const [token, id] of this.auth.sessions) if (id === userId) this.auth.sessions.delete(token);
    }
    return true;
  }
}

class MemoryAdminMfaRepository implements AdminMfaRepository {
  states = new Map<string, AdminMfaState>();
  challenges = new Map<string, AdminMfaChallenge>();
  recoveryCodes = new Map<string, Set<string>>();
  failures = new Map<string, number>();
  async isEnabled(userId: string) { return this.states.get(userId)?.enabled ?? false; }
  async isRateLimited(userId: string) { return (this.failures.get(userId) ?? 0) >= 10; }
  async createChallenge(userId: string, purpose: AdminMfaPurpose) {
    const token = `mfa-challenge-${Math.random()}`;
    this.challenges.set(token, { userId, purpose, attempts: 0 });
    return token;
  }
  async findChallenge(token: string) { return this.challenges.get(token); }
  async savePendingSecret(userId: string, pendingSecretEncrypted: string) {
    const state = this.states.get(userId) ?? { enabled: false, secretEncrypted: null, pendingSecretEncrypted: null, lastTotpStep: -1 };
    state.pendingSecretEncrypted = pendingSecretEncrypted;
    this.states.set(userId, state);
  }
  async getState(userId: string) { return this.states.get(userId); }
  async recordFailure(token: string) {
    const challenge = this.challenges.get(token);
    if (!challenge) return;
    challenge.attempts += 1;
    this.failures.set(challenge.userId, (this.failures.get(challenge.userId) ?? 0) + 1);
    if (challenge.attempts >= 5) this.challenges.delete(token);
  }
  async completeEnrollment(token: string, userId: string, encryptedSecret: string, step: number, recoveryHashes: string[]) {
    const challenge = this.challenges.get(token);
    if (!challenge || challenge.userId !== userId || challenge.purpose !== "enroll") return false;
    this.states.set(userId, { enabled: true, secretEncrypted: encryptedSecret, pendingSecretEncrypted: null, lastTotpStep: step });
    this.recoveryCodes.set(userId, new Set(recoveryHashes));
    this.challenges.delete(token);
    return true;
  }
  async completeTotpLogin(token: string, userId: string, step: number) {
    const challenge = this.challenges.get(token);
    const state = this.states.get(userId);
    if (!challenge || challenge.userId !== userId || challenge.purpose !== "login" || !state?.enabled || state.lastTotpStep >= step) return false;
    state.lastTotpStep = step;
    this.challenges.delete(token);
    return true;
  }
  async completeRecoveryLogin(token: string, userId: string, recoveryHash: string) {
    const challenge = this.challenges.get(token);
    const codes = this.recoveryCodes.get(userId);
    if (!challenge || challenge.userId !== userId || challenge.purpose !== "login" || !codes?.delete(recoveryHash)) return false;
    this.challenges.delete(token);
    return true;
  }
}

class MemoryLoginAttemptLimiter implements LoginAttemptLimiter {
  private readonly windows = new Map<string, number>();

  async consume(email: string, sourceAddress: string) {
    const key = `${email}\0${sourceAddress}`;
    const attempts = this.windows.get(key) ?? 0;
    if (attempts >= 10) return { allowed: false, retryAfterSeconds: 900 };
    this.windows.set(key, attempts + 1);
    return { allowed: true, retryAfterSeconds: 900 };
  }

  async clear(email: string, sourceAddress: string) {
    this.windows.delete(`${email}\0${sourceAddress}`);
  }
}

function makeApp(
  repository: AuthRepository,
  mfa = new MemoryAdminMfaRepository(),
  loginAttemptLimiter: LoginAttemptLimiter = new MemoryLoginAttemptLimiter()
) {
  const app = express();
  app.set("trust proxy", ["loopback"]);
  app.use(express.json());
  app.use(cookieParser());
  app.use(requestIdMiddleware);
  app.use("/api/v1/auth", createAuthRouter(repository, {
    sessionTtlHours: 12,
    secureCookie: false,
    mfaRepository: mfa,
    mfaEncryptionKey: "a".repeat(64),
    emailCodeRepository: new MemoryEmailCodeRepository(repository as MemoryAuthRepository),
    emailDeliveryConfigured: true,
    sendEmailCode: async () => {},
    loginAttemptLimiter
  }));
  app.get("/api/v1/admin", requireAuthenticated(repository, sessionCookieName), requireRoles("Admin"), (_req, res) => res.json({ success: true }));
  app.get("/api/v1/users/:id", requireAuthenticated(repository, sessionCookieName), requireResourceOwner(async (req) => req.params.id), (_req, res) => res.json({ success: true }));
  app.use(errorHandler);
  return app;
}

function responseCookies(response: Response): string[] {
  const cookies = response.headers["set-cookie"];
  return Array.isArray(cookies) ? cookies : cookies ? [cookies] : [];
}

describe("authentication and authorization", () => {
  let repository: MemoryAuthRepository;
  let app: express.Express;
  beforeEach(() => { repository = new MemoryAuthRepository(); app = makeApp(repository); });

  it("registers only as Patient and rejects role escalation", async () => {
    const escalated = await request(app).post("/api/v1/auth/register").send({ email: "person@example.test", password: "long-password-123", role: "Admin" });
    expect(escalated.status).toBe(400);
    expect(repository.users).toHaveLength(0);
    const registered = await request(app).post("/api/v1/auth/register").send({ email: "person@example.test", password: "long-password-123" });
    expect(registered.status).toBe(201);
    expect(registered.body.data.emailVerificationRequired).toBe(true);
    expect(responseCookies(registered)).toHaveLength(0);
    const beforeVerification = await request(app).post("/api/v1/auth/login").send({ email: "person@example.test", password: "long-password-123" });
    expect(beforeVerification.status).toBe(403);
    expect(beforeVerification.body.error.code).toBe("EMAIL_NOT_VERIFIED");
    const verified = await request(app).post("/api/v1/auth/email/verification/confirm").send({ email: "person@example.test", code: "123456" });
    expect(verified.status).toBe(200);
    expect(verified.body.data.user.role).toBe("Patient");
    expect(responseCookies(verified)[0]).toContain("HttpOnly");
  });

  it("resets a verified account password with an email code and revokes existing sessions", async () => {
    const user = await repository.createPatient("verified@example.test", "old-password-123");
    repository.users[0]!.email_verified = true;
    const session = await repository.createSession(user.id, 12);
    const resetRequest = await request(app).post("/api/v1/auth/password/reset/request").send({ email: user.email });
    expect(resetRequest.status).toBe(200);
    expect(resetRequest.body.data.accepted).toBe(true);
    const reset = await request(app).post("/api/v1/auth/password/reset/confirm").send({
      email: user.email,
      code: "123456",
      password: "new-password-123"
    });
    expect(reset.status).toBe(200);
    expect(await repository.findSession(session)).toBeUndefined();
    const login = await request(app).post("/api/v1/auth/login").send({ email: user.email, password: "new-password-123" });
    expect(login.status).toBe(200);
  });

  it("rejects invalid login and inactive accounts with a generic response", async () => {
    await repository.createPatient("person@example.test", "long-password-123");
    const invalid = await request(app).post("/api/v1/auth/login").send({ email: "person@example.test", password: "wrong-password-123" });
    expect(invalid.status).toBe(401);
    expect(invalid.body.error.code).toBe("INVALID_CREDENTIALS");
    repository.users[0]!.status = "inactive";
    const inactive = await request(app).post("/api/v1/auth/login").send({ email: "person@example.test", password: "long-password-123" });
    expect(inactive.status).toBe(401);
    expect(inactive.body.error.code).toBe("INVALID_CREDENTIALS");
  });

  it("limits password attempts per account and source while allowing a different source", async () => {
    await repository.createPatient("person@example.test", "long-password-123");
    repository.users[0]!.email_verified = true;
    const source = "203.0.113.10";
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const invalid = await request(app)
        .post("/api/v1/auth/login")
        .set("X-Forwarded-For", source)
        .send({ email: "person@example.test", password: "wrong-password-123" });
      expect(invalid.status).toBe(401);
    }

    const limited = await request(app)
      .post("/api/v1/auth/login")
      .set("X-Forwarded-For", source)
      .send({ email: "person@example.test", password: "wrong-password-123" });
    expect(limited.status).toBe(429);
    expect(limited.headers["retry-after"]).toBe("900");
    expect(limited.body.error.code).toBe("LOGIN_RATE_LIMITED");

    const otherSource = await request(app)
      .post("/api/v1/auth/login")
      .set("X-Forwarded-For", "203.0.113.11")
      .send({ email: "person@example.test", password: "long-password-123" });
    expect(otherSource.status).toBe(200);
  });

  it("blocks unauthenticated users from protected routes", async () => {
    const response = await request(app).get("/api/v1/admin");
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("denies a Patient access to an Admin-only route and a different user's resource", async () => {
    const user = await repository.createPatient("person@example.test", "long-password-123");
    const token = await repository.createSession(user.id, 12);
    const admin = await request(app).get("/api/v1/admin").set("Cookie", `${sessionCookieName}=${token}`);
    expect(admin.status).toBe(403);
    const ownRecord = await request(app).get(`/api/v1/users/${user.id}`).set("Cookie", `${sessionCookieName}=${token}`);
    expect(ownRecord.status).toBe(200);
    const otherRecord = await request(app).get("/api/v1/users/someone-else").set("Cookie", `${sessionCookieName}=${token}`);
    expect(otherRecord.status).toBe(403);
  });

  it("logs out and invalidates the server-side session", async () => {
    const user = await repository.createPatient("person@example.test", "long-password-123");
    const token = await repository.createSession(user.id, 12);
    const logout = await request(app).post("/api/v1/auth/logout").set("Cookie", `${sessionCookieName}=${token}`);
    expect(logout.status).toBe(200);
    const currentUser = await request(app).get("/api/v1/auth/me").set("Cookie", `${sessionCookieName}=${token}`);
    expect(currentUser.status).toBe(401);
  });

  it("requires Admin TOTP enrollment before issuing an Admin session", async () => {
    const bcrypt = await import("bcryptjs");
    repository.users.push({
      id: "admin-1",
      email: "admin@example.test",
      password_hash: await bcrypt.hash("AdminPassword!2026", 4),
      role: "Admin",
      status: "active",
      email_verified: true
    });
    const mfa = new MemoryAdminMfaRepository();
    app = makeApp(repository, mfa);
    const login = await request(app).post("/api/v1/auth/login").send({ email: "admin@example.test", password: "AdminPassword!2026" });
    expect(login.status).toBe(200);
    expect(login.body.data).toMatchObject({ mfaRequired: true, enrollmentRequired: true });
    expect(responseCookies(login).join(";")).toContain("healthcare_admin_mfa=");
    expect(responseCookies(login).join(";")).not.toContain(`${sessionCookieName}=`);
    const cookie = responseCookies(login).filter((value) => value.startsWith("healthcare_admin_mfa=")).at(-1)!.split(";")[0]!;
    const setup = await request(app).post("/api/v1/auth/mfa/setup").set("Cookie", cookie);
    expect(setup.status).toBe(200);
    expect(setup.body.data.otpauthUri).toContain("otpauth://totp/");
    const code = createTotpCode(setup.body.data.secret).code;
    const verified = await request(app).post("/api/v1/auth/mfa/verify").set("Cookie", cookie).send({ code });
    expect(verified.status).toBe(200);
    expect(verified.body.data.user.role).toBe("Admin");
    expect(verified.body.data.recoveryCodes).toHaveLength(10);
    expect(responseCookies(verified).join(";")).toContain(`${sessionCookieName}=`);
    const adminSession = responseCookies(verified).find((value) => value.startsWith(`${sessionCookieName}=`))!.split(";")[0]!;
    expect((await request(app).get("/api/v1/admin").set("Cookie", adminSession)).status).toBe(200);
  });

  it("requires a fresh TOTP or one-time recovery code for each Admin login", async () => {
    const bcrypt = await import("bcryptjs");
    const { encryptTotpSecret, hashRecoveryCode, createRecoveryCodes } = await import("../src/auth/totp.js");
    const secret = "JBSWY3DPEHPK3PXP";
    const recoveryCode = "A1B2-C3D4-E5F6-7890-ABCD-EF01";
    repository.users.push({
      id: "admin-2",
      email: "admin2@example.test",
      password_hash: await bcrypt.hash("AdminPassword!2026", 4),
      role: "Admin",
      status: "active",
      email_verified: true
    });
    const mfa = new MemoryAdminMfaRepository();
    const { step } = createTotpCode(secret);
    mfa.states.set("admin-2", { enabled: true, secretEncrypted: encryptTotpSecret(secret, Buffer.from("a".repeat(64), "hex")), pendingSecretEncrypted: null, lastTotpStep: step - 1 });
    mfa.recoveryCodes.set("admin-2", new Set([hashRecoveryCode(recoveryCode), ...createRecoveryCodes().map(hashRecoveryCode)]));
    app = makeApp(repository, mfa);

    const login = await request(app).post("/api/v1/auth/login").send({ email: "admin2@example.test", password: "AdminPassword!2026" });
    expect(login.body.data).toMatchObject({ mfaRequired: true, enrollmentRequired: false });
    const challengeCookie = responseCookies(login).filter((value) => value.startsWith("healthcare_admin_mfa=")).at(-1)!.split(";")[0]!;
    const totpLogin = await request(app).post("/api/v1/auth/mfa/verify").set("Cookie", challengeCookie).send({ code: createTotpCode(secret).code });
    expect(totpLogin.status).toBe(200);

    const replayLogin = await request(app).post("/api/v1/auth/login").send({ email: "admin2@example.test", password: "AdminPassword!2026" });
    const replayCookie = responseCookies(replayLogin).filter((value) => value.startsWith("healthcare_admin_mfa=")).at(-1)!.split(";")[0]!;
    const replayTotp = await request(app).post("/api/v1/auth/mfa/verify").set("Cookie", replayCookie).send({ code: createTotpCode(secret).code });
    expect(replayTotp.status).toBe(401);

    const recoveryAttempt = await request(app).post("/api/v1/auth/login").send({ email: "admin2@example.test", password: "AdminPassword!2026" });
    const recoveryCookie = responseCookies(recoveryAttempt).filter((value) => value.startsWith("healthcare_admin_mfa=")).at(-1)!.split(";")[0]!;
    const recoveryLogin = await request(app).post("/api/v1/auth/mfa/verify").set("Cookie", recoveryCookie).send({ code: recoveryCode });
    expect(recoveryLogin.status).toBe(200);

    const recoveryReplayAttempt = await request(app).post("/api/v1/auth/login").send({ email: "admin2@example.test", password: "AdminPassword!2026" });
    const recoveryReplayCookie = responseCookies(recoveryReplayAttempt).filter((value) => value.startsWith("healthcare_admin_mfa=")).at(-1)!.split(";")[0]!;
    const replayRecovery = await request(app).post("/api/v1/auth/mfa/verify").set("Cookie", recoveryReplayCookie).send({ code: recoveryCode });
    expect(replayRecovery.status).toBe(401);
    expect(replayRecovery.body.error.code).toBe("MFA_INVALID_CODE");
  });

  it("throttles repeated invalid Admin MFA codes across fresh challenges", async () => {
    const bcrypt = await import("bcryptjs");
    const { encryptTotpSecret } = await import("../src/auth/totp.js");
    const secret = "JBSWY3DPEHPK3PXP";
    repository.users.push({
      id: "admin-rate",
      email: "rate@example.test",
      password_hash: await bcrypt.hash("AdminPassword!2026", 4),
      role: "Admin",
      status: "active",
      email_verified: true
    });
    const mfa = new MemoryAdminMfaRepository();
    mfa.states.set("admin-rate", { enabled: true, secretEncrypted: encryptTotpSecret(secret, Buffer.from("a".repeat(64), "hex")), pendingSecretEncrypted: null, lastTotpStep: -1 });
    app = makeApp(repository, mfa);
    let wrongCode = "000000";
    while (verifyTotpCode(secret, wrongCode) !== undefined) wrongCode = String(Number(wrongCode) + 1).padStart(6, "0");

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const login = await request(app).post("/api/v1/auth/login").send({ email: "rate@example.test", password: "AdminPassword!2026" });
      expect(login.status).toBe(200);
      const cookie = responseCookies(login).filter((value) => value.startsWith("healthcare_admin_mfa=")).at(-1)!.split(";")[0]!;
      const failure = await request(app).post("/api/v1/auth/mfa/verify").set("Cookie", cookie).send({ code: wrongCode });
      expect(failure.status).toBe(401);
    }
    const locked = await request(app).post("/api/v1/auth/login").send({ email: "rate@example.test", password: "AdminPassword!2026" });
    expect(locked.status).toBe(429);
    expect(locked.body.error.code).toBe("MFA_RATE_LIMITED");
  });
});
