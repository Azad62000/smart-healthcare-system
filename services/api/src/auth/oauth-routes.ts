import { createHash, randomBytes } from "node:crypto";
import { Router } from "express";
import { createRemoteJWKSet, jwtVerify, SignJWT } from "jose";
import type { AuthRepository } from "./repository.js";
import type { AdminMfaRepository } from "./admin-mfa-repository.js";
import type { OAuthProvider, OAuthRepository } from "./oauth-repository.js";
import { config } from "../config.js";
import { ApiRequestError } from "../request-error.js";
import { log } from "../logger.js";

interface OAuthRouteOptions {
  authRepository: AuthRepository;
  oauthRepository: OAuthRepository;
  mfaRepository?: AdminMfaRepository;
  mfaEncryptionKey?: string;
  sessionTtlHours: number;
  secureCookie: boolean;
  webOrigin: string;
  apiPublicUrl?: string;
}

const sessionCookieName = "healthcare_session";
const mfaCookieName = "healthcare_admin_mfa";
const oauthCookiePath = "/api/v1/auth/oauth";
const providers = ["google", "apple"] as const;
const googleJwks = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"), { timeoutDuration: 10_000 });
const appleJwks = createRemoteJWKSet(new URL("https://appleid.apple.com/auth/keys"), { timeoutDuration: 10_000 });
type OidcClaims = { email?: string; email_verified?: boolean | string; nonce?: string };

function providerReady(provider: OAuthProvider): boolean {
  return provider === "google"
    ? Boolean(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET)
    : Boolean(config.APPLE_CLIENT_ID && config.APPLE_TEAM_ID && config.APPLE_KEY_ID && config.APPLE_PRIVATE_KEY);
}

function clientId(provider: OAuthProvider): string {
  return provider === "google" ? config.GOOGLE_CLIENT_ID! : config.APPLE_CLIENT_ID!;
}

function callbackUrl(provider: OAuthProvider, options: OAuthRouteOptions): string {
  const base = options.apiPublicUrl ?? config.API_PUBLIC_URL ?? `http://${config.API_HOST}:${config.API_PORT}`;
  return new URL(`/api/v1/auth/oauth/${provider}/callback`, base).toString();
}

function redirectFailure(response: import("express").Response, options: OAuthRouteOptions): void {
  response.redirect(new URL("/signin?oauth=failed", options.webOrigin).toString());
}

function oauthStateCookieName(state: string): string {
  return `healthcare_oauth_${state}`;
}

async function appleClientSecret(): Promise<string> {
  const key = await import("jose").then(({ importPKCS8 }) =>
    importPKCS8(config.APPLE_PRIVATE_KEY!.replace(/\\n/g, "\n"), "ES256")
  );
  return new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: config.APPLE_KEY_ID! })
    .setIssuer(config.APPLE_TEAM_ID!)
    .setSubject(config.APPLE_CLIENT_ID!)
    .setAudience("https://appleid.apple.com")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(key);
}

async function exchangeCode(provider: OAuthProvider, code: string, verifier: string, redirectUri: string): Promise<string> {
  const tokenUrl = provider === "google" ? "https://oauth2.googleapis.com/token" : "https://appleid.apple.com/auth/token";
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: clientId(provider),
    code_verifier: verifier
  });
  if (provider === "google") params.set("client_secret", config.GOOGLE_CLIENT_SECRET!);
  else params.set("client_secret", await appleClientSecret());
  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: params,
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) throw new ApiRequestError(502, "OAUTH_PROVIDER_ERROR", "The identity provider could not complete sign in.");
  const body = await response.json() as { id_token?: string };
  if (!body.id_token) throw new ApiRequestError(502, "OAUTH_PROVIDER_ERROR", "The identity provider returned an invalid response.");
  return body.id_token;
}

async function verifyIdToken(provider: OAuthProvider, token: string, nonce: string): Promise<OidcClaims & { sub: string }> {
  const keySet = provider === "google" ? googleJwks : appleJwks;
  const issuer = provider === "google" ? ["https://accounts.google.com", "accounts.google.com"] : "https://appleid.apple.com";
  const { payload } = await jwtVerify(token, keySet, { issuer, audience: clientId(provider) });
  if (typeof payload.sub !== "string" || payload.nonce !== nonce || (payload.azp !== undefined && payload.azp !== clientId(provider))) {
    throw new ApiRequestError(401, "OAUTH_IDENTITY_INVALID", "The identity provider response could not be verified.");
  }
  return payload as OidcClaims & { sub: string };
}

function verifiedEmail(claims: OidcClaims): boolean {
  return claims.email_verified === true || claims.email_verified === "true";
}

export function createOAuthRouter(options: OAuthRouteOptions): Router {
  const router = Router();

  router.get("/:provider/start", async (request, response, next) => {
    try {
      const provider = request.params.provider as OAuthProvider;
      if (!providers.includes(provider)) throw new ApiRequestError(404, "OAUTH_PROVIDER_NOT_FOUND", "The identity provider is not supported.");
      if (!providerReady(provider)) {
        response.redirect(new URL(`/signin?oauth=unavailable&provider=${provider}`, options.webOrigin).toString());
        return;
      }
      const state = randomBytes(32).toString("base64url");
      const nonce = randomBytes(32).toString("base64url");
      const verifier = randomBytes(32).toString("base64url");
      const challenge = createHash("sha256").update(verifier).digest("base64url");
      await options.oauthRepository.createFlow(state, { provider, nonce, codeVerifier: verifier });
      response.cookie(oauthStateCookieName(state), state, {
        httpOnly: true,
        secure: options.secureCookie,
        sameSite: "lax",
        path: oauthCookiePath,
        maxAge: 10 * 60 * 1000
      });
      const redirectUri = callbackUrl(provider, options);
      const authorization = new URL(provider === "google" ? "https://accounts.google.com/o/oauth2/v2/auth" : "https://appleid.apple.com/auth/authorize");
      authorization.search = new URLSearchParams({
        response_type: "code",
        client_id: clientId(provider),
        redirect_uri: redirectUri,
        scope: "openid email",
        state,
        nonce,
        code_challenge: challenge,
        code_challenge_method: "S256",
        ...(provider === "apple" ? { response_mode: "query" } : {})
      }).toString();
      response.redirect(authorization.toString());
    } catch (error) { next(error); }
  });

  router.get("/:provider/callback", async (request, response) => {
    try {
      const provider = request.params.provider as OAuthProvider;
      const state = typeof request.query.state === "string" ? request.query.state : "";
      const code = typeof request.query.code === "string" ? request.query.code : "";
      if (!providers.includes(provider) || !providerReady(provider) || !state || !code || request.query.error) {
        redirectFailure(response, options);
        return;
      }
      if (!/^[A-Za-z0-9_-]{43}$/.test(state) || request.cookies?.[oauthStateCookieName(state)] !== state) {
        redirectFailure(response, options);
        return;
      }
      response.clearCookie(oauthStateCookieName(state), {
        httpOnly: true,
        secure: options.secureCookie,
        sameSite: "lax",
        path: oauthCookiePath
      });
      const flow = await options.oauthRepository.consumeFlow(state, provider);
      if (!flow) { redirectFailure(response, options); return; }
      const idToken = await exchangeCode(provider, code, flow.codeVerifier, callbackUrl(provider, options));
      const claims = await verifyIdToken(provider, idToken, flow.nonce);
      const email = claims.email?.trim().toLowerCase();
      const user = await options.oauthRepository.findOrCreateUser(provider, claims.sub, email, verifiedEmail(claims));
      if (user.status !== "active") { redirectFailure(response, options); return; }

      if (user.role === "Admin") {
        const mfa = options.mfaRepository;
        if (!mfa || !options.mfaEncryptionKey || await mfa.isRateLimited(user.id)) {
          redirectFailure(response, options);
          return;
        }
        const purpose = await mfa.isEnabled(user.id) ? "login" : "enroll";
        const challenge = await mfa.createChallenge(user.id, purpose);
        if (!challenge) { redirectFailure(response, options); return; }
        response.cookie(mfaCookieName, challenge, {
          httpOnly: true,
          secure: options.secureCookie,
          sameSite: "lax",
          path: "/api/v1/auth",
          maxAge: 5 * 60 * 1000
        });
        response.redirect(new URL(`/signin?mfa=required${purpose === "enroll" ? "&enroll=1" : ""}`, options.webOrigin).toString());
        return;
      }

      const token = await options.authRepository.createSession(user.id, options.sessionTtlHours);
      response.cookie(sessionCookieName, token, {
        httpOnly: true,
        secure: options.secureCookie,
        sameSite: "lax",
        path: "/",
        maxAge: options.sessionTtlHours * 60 * 60 * 1000
      });
      const destination = user.role === "Doctor" ? "/doctor" : "/patient";
      response.redirect(new URL(destination, options.webOrigin).toString());
    } catch {
      log("warn", "auth.oauth.callback.failed", { path: "/api/v1/auth/oauth/callback", statusCode: 502 });
      redirectFailure(response, options);
    }
  });

  return router;
}
