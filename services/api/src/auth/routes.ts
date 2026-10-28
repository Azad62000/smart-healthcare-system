import { Router } from "express";
import { z } from "zod";
import { validateRequest } from "../middleware/validate-request.js";
import { ApiRequestError } from "../request-error.js";
import type { AuthRepository, PublicUser } from "./repository.js";
import { AuthService } from "./service.js";
import { requireAuthenticated } from "./authorization.js";
import type { AdminMfaRepository } from "./admin-mfa-repository.js";
import type { EmailCodePurpose, EmailCodeRepository } from "./email-code-repository.js";
import { isEmailDeliveryConfigured, sendAuthCode } from "./email.js";
import type { OAuthRepository } from "./oauth-repository.js";
import type { LoginAttemptLimiter } from "./login-rate-limiter.js";
import { createOAuthRouter } from "./oauth-routes.js";
import bcrypt from "bcryptjs";
import {
  createOtpAuthUri,
  createRecoveryCodes,
  createTotpSecret,
  decryptTotpSecret,
  encryptTotpSecret,
  hashRecoveryCode,
  verifyTotpCode
} from "./totp.js";

const credentialsSchema = z.object({
  email: z.string().trim().email().max(254).transform((email) => email.toLowerCase()),
  password: z.string().min(12).max(128)
}).strict();
const emailSchema = z.object({ email: z.string().trim().email().max(254).transform((email) => email.toLowerCase()) }).strict();
const verifyEmailSchema = emailSchema.extend({ code: z.string().regex(/^\d{6}$/) }).strict();
const resetPasswordSchema = verifyEmailSchema.extend({ password: z.string().min(12).max(128) }).strict();

export const sessionCookieName = "healthcare_session";
const adminMfaCookieName = "healthcare_admin_mfa";
const adminMfaUnavailable = () => new ApiRequestError(503, "ADMIN_MFA_UNAVAILABLE", "Admin multi-factor authentication is not configured.");
const invalidMfaChallenge = () => new ApiRequestError(401, "MFA_CHALLENGE_INVALID", "The Admin verification session has expired. Sign in again.");
const invalidMfaCode = () => new ApiRequestError(401, "MFA_INVALID_CODE", "The verification code is invalid or has already been used.");
export interface AuthRouteOptions {
  sessionTtlHours: number;
  secureCookie: boolean;
  cookieName?: string;
  mfaRepository?: AdminMfaRepository;
  mfaEncryptionKey?: string;
  emailCodeRepository?: EmailCodeRepository;
  emailDeliveryConfigured?: boolean;
  sendEmailCode?: (email: string, code: string, purpose: EmailCodePurpose) => Promise<void>;
  oauthRepository?: OAuthRepository;
  loginAttemptLimiter: LoginAttemptLimiter;
  webOrigin?: string;
  apiPublicUrl?: string;
}

function setSessionCookie(response: Parameters<import("express").RequestHandler>[1], token: string, options: AuthRouteOptions) {
  response.cookie(options.cookieName ?? sessionCookieName, token, {
    httpOnly: true,
    secure: options.secureCookie,
    sameSite: "lax",
    path: "/",
    maxAge: options.sessionTtlHours * 60 * 60 * 1000
  });
}

function setMfaCookie(response: Parameters<import("express").RequestHandler>[1], token: string, options: AuthRouteOptions) {
  response.cookie(adminMfaCookieName, token, {
    httpOnly: true,
    secure: options.secureCookie,
    sameSite: "lax",
    path: "/api/v1/auth",
    maxAge: 5 * 60 * 1000
  });
}

function clearMfaCookie(response: Parameters<import("express").RequestHandler>[1], options: AuthRouteOptions) {
  response.clearCookie(adminMfaCookieName, { httpOnly: true, secure: options.secureCookie, sameSite: "lax", path: "/api/v1/auth" });
}

function publicUser(user: PublicUser) { return { id: user.id, email: user.email, role: user.role }; }

export function createAuthRouter(repository: AuthRepository, options: AuthRouteOptions): Router {
  const router = Router();
  const cookieName = options.cookieName ?? sessionCookieName;
  const service = new AuthService(repository);
  const emailCodes = options.emailCodeRepository;
  const emailIsConfigured = options.emailDeliveryConfigured ?? isEmailDeliveryConfigured();
  const deliverEmailCode = options.sendEmailCode ?? sendAuthCode;
  if (options.oauthRepository && options.webOrigin) {
    router.use("/oauth", createOAuthRouter({
      authRepository: repository,
      oauthRepository: options.oauthRepository,
      mfaRepository: options.mfaRepository,
      mfaEncryptionKey: options.mfaEncryptionKey,
      sessionTtlHours: options.sessionTtlHours,
      secureCookie: options.secureCookie,
      webOrigin: options.webOrigin,
      apiPublicUrl: options.apiPublicUrl
    }));
  }

  router.post("/register", validateRequest({ body: credentialsSchema }), async (_request, response, next) => {
    try {
      const credentials = response.locals.validated.body as z.infer<typeof credentialsSchema>;
      // Public registration is always Patient. Unknown and attempted privileged properties are rejected by strict schema.
      if (!emailCodes || !emailIsConfigured) throw new ApiRequestError(503, "EMAIL_DELIVERY_NOT_CONFIGURED", "Email delivery is not configured.");
      const user = await service.register(credentials.email, credentials.password);
      const code = await emailCodes.issue(user.id, "verify_email");
      if (code) await deliverEmailCode(user.email, code, "verify_email");
      response.status(201).json({ success: true, data: { emailVerificationRequired: true }, meta: { requestId: response.locals.requestId } });
    } catch (error) { next(error); }
  });

  router.post("/email/verification/request", validateRequest({ body: emailSchema }), async (request, response, next) => {
    try {
      const { email } = response.locals.validated.body as z.infer<typeof emailSchema>;
      const user = await repository.findByEmail(email);
      if (user && !user.email_verified && user.status === "active" && emailCodes && emailIsConfigured) {
        const code = await emailCodes.issue(user.id, "verify_email");
        if (code) await deliverEmailCode(user.email, code, "verify_email");
      }
      response.json({ success: true, data: { accepted: true }, meta: { requestId: response.locals.requestId } });
    } catch (error) { next(error); }
  });

  router.post("/email/verification/confirm", validateRequest({ body: verifyEmailSchema }), async (request, response, next) => {
    try {
      if (!emailCodes || !emailIsConfigured) throw new ApiRequestError(503, "EMAIL_DELIVERY_NOT_CONFIGURED", "Email delivery is not configured.");
      const { email, code } = response.locals.validated.body as z.infer<typeof verifyEmailSchema>;
      const user = await repository.findByEmail(email);
      if (!user || user.status !== "active" || !await emailCodes.consume(user.id, "verify_email", code)) {
        throw new ApiRequestError(400, "EMAIL_CODE_INVALID", "The verification code is invalid or expired.");
      }
      const token = await repository.createSession(user.id, options.sessionTtlHours);
      setSessionCookie(response, token, options);
      response.json({ success: true, data: { user: publicUser(user) }, meta: { requestId: response.locals.requestId } });
    } catch (error) { next(error); }
  });

  router.post("/password/reset/request", validateRequest({ body: emailSchema }), async (request, response, next) => {
    try {
      if (!emailCodes || !emailIsConfigured) throw new ApiRequestError(503, "EMAIL_DELIVERY_NOT_CONFIGURED", "Email delivery is not configured.");
      const { email } = response.locals.validated.body as z.infer<typeof emailSchema>;
      const user = await repository.findByEmail(email);
      if (user?.email_verified && user.status === "active") {
        const code = await emailCodes.issue(user.id, "password_reset");
        if (code) await deliverEmailCode(user.email, code, "password_reset");
      }
      response.json({ success: true, data: { accepted: true }, meta: { requestId: response.locals.requestId } });
    } catch (error) { next(error); }
  });

  router.post("/password/reset/confirm", validateRequest({ body: resetPasswordSchema }), async (request, response, next) => {
    try {
      if (!emailCodes || !emailIsConfigured) throw new ApiRequestError(503, "EMAIL_DELIVERY_NOT_CONFIGURED", "Email delivery is not configured.");
      const { email, code, password } = response.locals.validated.body as z.infer<typeof resetPasswordSchema>;
      const user = await repository.findByEmail(email);
      const passwordHash = await bcrypt.hash(password, 12);
      if (!user?.email_verified || user.status !== "active" || !await emailCodes.consume(user.id, "password_reset", code, passwordHash)) {
        throw new ApiRequestError(400, "EMAIL_CODE_INVALID", "The verification code is invalid or expired.");
      }
      response.json({ success: true, data: { passwordReset: true }, meta: { requestId: response.locals.requestId } });
    } catch (error) { next(error); }
  });

  router.post("/login", validateRequest({ body: credentialsSchema }), async (request, response, next) => {
    try {
      const credentials = response.locals.validated.body as z.infer<typeof credentialsSchema>;
      const sourceAddress = request.ip ?? request.socket.remoteAddress ?? "unknown";
      const limit = await options.loginAttemptLimiter.consume(credentials.email, sourceAddress);
      if (!limit.allowed) {
        response.setHeader("Retry-After", String(limit.retryAfterSeconds));
        throw new ApiRequestError(429, "LOGIN_RATE_LIMITED", "Too many sign-in attempts. Try again later.");
      }
      const existingToken = request.cookies?.[cookieName];
      if (typeof existingToken === "string") await repository.deleteSession(existingToken);
      if (typeof request.cookies?.[adminMfaCookieName] === "string") clearMfaCookie(response, options);
      let user: PublicUser;
      try {
        user = await service.login(credentials.email, credentials.password);
      } catch (error) {
        if (!(error instanceof ApiRequestError && error.code === "INVALID_CREDENTIALS")) {
          await options.loginAttemptLimiter.clear(credentials.email, sourceAddress);
        }
        throw error;
      }
      await options.loginAttemptLimiter.clear(credentials.email, sourceAddress);
      if (user.role === "Admin") {
        const mfa = options.mfaRepository;
        if (!mfa || !options.mfaEncryptionKey) throw adminMfaUnavailable();
        if (await mfa.isRateLimited(user.id)) throw new ApiRequestError(429, "MFA_RATE_LIMITED", "Admin verification is temporarily locked. Try again in 15 minutes.");
        const purpose = await mfa.isEnabled(user.id) ? "login" : "enroll";
        const challenge = await mfa.createChallenge(user.id, purpose);
        if (!challenge) throw new ApiRequestError(429, "MFA_RATE_LIMITED", "Admin verification is temporarily locked. Try again in 15 minutes.");
        setMfaCookie(response, challenge, options);
        response.json({ success: true, data: { mfaRequired: true, enrollmentRequired: purpose === "enroll" }, meta: { requestId: response.locals.requestId } });
        return;
      }
      const token = await repository.createSession(user.id, options.sessionTtlHours);
      setSessionCookie(response, token, options);
      response.json({ success: true, data: { user: publicUser(user) }, meta: { requestId: response.locals.requestId } });
    } catch (error) { next(error); }
  });

  router.post("/mfa/setup", async (request, response, next) => {
    try {
      const mfa = options.mfaRepository;
      const key = options.mfaEncryptionKey;
      const challengeToken = request.cookies?.[adminMfaCookieName];
      if (!mfa || !key) throw adminMfaUnavailable();
      if (typeof challengeToken !== "string") throw invalidMfaChallenge();
      const challenge = await mfa.findChallenge(challengeToken);
      if (!challenge || challenge.purpose !== "enroll") throw invalidMfaChallenge();
      const user = await repository.findById(challenge.userId);
      if (!user || user.role !== "Admin" || user.status !== "active") throw invalidMfaChallenge();
      // Keep setup retries stable. If a browser retries this request, do not
      // replace the seed that is already displayed in the authenticator app.
      const state = await mfa.getState(user.id);
      const secret = state?.pendingSecretEncrypted && !state.enabled
        ? decryptTotpSecret(state.pendingSecretEncrypted, Buffer.from(key, "hex"))
        : createTotpSecret();
      if (!state?.pendingSecretEncrypted || state.enabled) {
        await mfa.savePendingSecret(user.id, encryptTotpSecret(secret, Buffer.from(key, "hex")));
      }
      response.json({
        success: true,
        data: { secret, otpauthUri: createOtpAuthUri(user.email, secret) },
        meta: { requestId: response.locals.requestId }
      });
    } catch (error) { next(error); }
  });

  router.post("/mfa/recovery/request", async (request, response, next) => {
    try {
      const mfa = options.mfaRepository;
      const challengeToken = request.cookies?.[adminMfaCookieName];
      if (!mfa || typeof challengeToken !== "string") throw invalidMfaChallenge();
      const challenge = await mfa.findChallenge(challengeToken);
      if (!challenge || challenge.purpose !== "login") throw invalidMfaChallenge();
      const user = await repository.findById(challenge.userId);
      if (!user || user.role !== "Admin" || user.status !== "active" || !user.email_verified) throw invalidMfaChallenge();
      if (!emailCodes || !emailIsConfigured) throw new ApiRequestError(503, "EMAIL_DELIVERY_NOT_CONFIGURED", "Security recovery email is not configured.");
      const code = await emailCodes.issue(user.id, "admin_mfa_recovery");
      if (code) await deliverEmailCode(user.email, code, "admin_mfa_recovery");
      response.json({ success: true, data: { accepted: true }, meta: { requestId: response.locals.requestId } });
    } catch (error) { next(error); }
  });

  router.post("/mfa/recovery/confirm", validateRequest({ body: z.object({ code: z.string().regex(/^\d{6}$/) }).strict() }), async (request, response, next) => {
    try {
      const mfa = options.mfaRepository;
      const challengeToken = request.cookies?.[adminMfaCookieName];
      if (!mfa || typeof challengeToken !== "string") throw invalidMfaChallenge();
      const challenge = await mfa.findChallenge(challengeToken);
      if (!challenge || challenge.purpose !== "login") throw invalidMfaChallenge();
      const user = await repository.findById(challenge.userId);
      const { code } = response.locals.validated.body as { code: string };
      if (!user || user.role !== "Admin" || user.status !== "active" || !user.email_verified || !emailCodes) {
        throw new ApiRequestError(400, "MFA_RECOVERY_CODE_INVALID", "The recovery code is invalid or expired.");
      }
      const consumed = await emailCodes.consume(user.id, "admin_mfa_recovery", code);
      if (!consumed) throw new ApiRequestError(400, "MFA_RECOVERY_CODE_INVALID", "The recovery code is invalid or expired.");
      if (!mfa.completeEmailRecovery) throw adminMfaUnavailable();
      const nextChallenge = await mfa.completeEmailRecovery(challengeToken, user.id);
      if (!nextChallenge) throw invalidMfaChallenge();
      setMfaCookie(response, nextChallenge, options);
      response.json({ success: true, data: { enrollmentRequired: true }, meta: { requestId: response.locals.requestId } });
    } catch (error) { next(error); }
  });

  router.post("/mfa/verify", validateRequest({ body: z.object({ code: z.string().trim().min(6).max(32) }).strict() }), async (request, response, next) => {
    try {
      const mfa = options.mfaRepository;
      const key = options.mfaEncryptionKey;
      const challengeToken = request.cookies?.[adminMfaCookieName];
      if (!mfa || !key) throw adminMfaUnavailable();
      if (typeof challengeToken !== "string") throw invalidMfaChallenge();
      const challenge = await mfa.findChallenge(challengeToken);
      if (!challenge) throw invalidMfaChallenge();
      const { code } = response.locals.validated.body as { code: string };
      const user = await repository.findById(challenge.userId);
      if (!user || user.role !== "Admin" || user.status !== "active") throw invalidMfaChallenge();
      const state = await mfa.getState(user.id);
      if (!state) throw invalidMfaChallenge();
      const encryptionKey = Buffer.from(key, "hex");
      let verifiedStep: number | undefined;
      let recoveryCodes: string[] | undefined;
      let verified = false;

      if (challenge.purpose === "enroll" && !state.enabled && state.pendingSecretEncrypted) {
        const pendingSecret = decryptTotpSecret(state.pendingSecretEncrypted, encryptionKey);
        verifiedStep = /^\d{6}$/.test(code) ? verifyTotpCode(pendingSecret, code) : undefined;
        if (verifiedStep !== undefined) {
          recoveryCodes = createRecoveryCodes();
          verified = await mfa.completeEnrollment(
            challengeToken,
            user.id,
            encryptTotpSecret(pendingSecret, encryptionKey),
            verifiedStep,
            recoveryCodes.map(hashRecoveryCode)
          );
        }
      } else if (challenge.purpose === "login" && state.enabled && state.secretEncrypted) {
        const secret = decryptTotpSecret(state.secretEncrypted, encryptionKey);
        verifiedStep = /^\d{6}$/.test(code) ? verifyTotpCode(secret, code) : undefined;
        if (verifiedStep !== undefined) verified = await mfa.completeTotpLogin(challengeToken, user.id, verifiedStep);
        else if (/^[a-fA-F0-9]{4}(?:-[a-fA-F0-9]{4}){5}$/.test(code)) {
          verified = await mfa.completeRecoveryLogin(challengeToken, user.id, hashRecoveryCode(code));
        }
      }
      if (!verified) {
        await mfa.recordFailure(challengeToken);
        throw invalidMfaCode();
      }
      const token = await repository.createSession(user.id, options.sessionTtlHours);
      setSessionCookie(response, token, options);
      clearMfaCookie(response, options);
      response.json({
        success: true,
        data: { user: publicUser(user), ...(recoveryCodes ? { recoveryCodes } : {}) },
        meta: { requestId: response.locals.requestId }
      });
    } catch (error) { next(error); }
  });

  router.post("/logout", requireAuthenticated(repository, cookieName), async (request, response, next) => {
    try {
      const token = request.cookies[cookieName] as string;
      await repository.deleteSession(token);
      response.clearCookie(cookieName, { httpOnly: true, secure: options.secureCookie, sameSite: "lax", path: "/" });
      response.json({ success: true, data: { loggedOut: true }, meta: { requestId: response.locals.requestId } });
    } catch (error) { next(error); }
  });

  router.get("/me", requireAuthenticated(repository, cookieName), (_request, response, next) => {
    const user = response.locals.user;
    if (!user) return next(new ApiRequestError(401, "UNAUTHENTICATED", "Authentication is required."));
    response.json({ success: true, data: { user: publicUser(user) }, meta: { requestId: response.locals.requestId } });
  });

  return router;
}
