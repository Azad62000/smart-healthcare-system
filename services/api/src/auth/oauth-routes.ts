import { createHash, createHmac, randomBytes } from "node:crypto";
import { Router } from "express";
import { createRemoteJWKSet, jwtVerify } from "jose";
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
const providers = ["google", "facebook"] as const;
const googleJwks = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"), { timeoutDuration: 10_000 });
type OidcClaims = { email?: string; email_verified?: boolean | string; nonce?: string };
type OAuthIdentity = { sub: string; email?: string; emailVerified: boolean };

function providerReady(provider: OAuthProvider): boolean {
  return provider === "google"
    ? Boolean(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET)
    : Boolean(config.FACEBOOK_APP_ID && config.FACEBOOK_APP_SECRET);
}

function clientId(provider: OAuthProvider): string {
  return provider === "google" ? config.GOOGLE_CLIENT_ID! : config.FACEBOOK_APP_ID!;
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

async function exchangeGoogleCode(code: string, verifier: string, redirectUri: string): Promise<string> {
  const tokenUrl = "https://oauth2.googleapis.com/token";
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: clientId("google"),
    client_secret: config.GOOGLE_CLIENT_SECRET!,
    code_verifier: verifier
  });
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

async function fetchFacebookIdentity(code: string, redirectUri: string): Promise<OAuthIdentity> {
  const version = config.FACEBOOK_GRAPH_API_VERSION;
  const tokenUrl = new URL(`https://graph.facebook.com/${version}/oauth/access_token`);
  tokenUrl.search = new URLSearchParams({
    client_id: config.FACEBOOK_APP_ID!,
    client_secret: config.FACEBOOK_APP_SECRET!,
    redirect_uri: redirectUri,
    code
  }).toString();
  const tokenResponse = await fetch(tokenUrl, { signal: AbortSignal.timeout(10_000) });
  if (!tokenResponse.ok) throw new ApiRequestError(502, "OAUTH_PROVIDER_ERROR", "The identity provider could not complete sign in.");
  const tokenBody = await tokenResponse.json() as { access_token?: string };
  if (!tokenBody.access_token) throw new ApiRequestError(502, "OAUTH_PROVIDER_ERROR", "The identity provider returned an invalid response.");

  const profileUrl = new URL(`https://graph.facebook.com/${version}/me`);
  profileUrl.searchParams.set("fields", "id,email");
  profileUrl.searchParams.set("appsecret_proof", createHmac("sha256", config.FACEBOOK_APP_SECRET!).update(tokenBody.access_token).digest("hex"));
  const profileResponse = await fetch(profileUrl, {
    headers: { authorization: `Bearer ${tokenBody.access_token}` },
    signal: AbortSignal.timeout(10_000)
  });
  if (!profileResponse.ok) throw new ApiRequestError(502, "OAUTH_PROVIDER_ERROR", "The identity provider could not return an account profile.");
  const profile = await profileResponse.json() as { id?: string; email?: string };
  if (!profile.id || !profile.email) throw new ApiRequestError(401, "OAUTH_IDENTITY_INVALID", "The identity provider did not return a usable verified email address.");
  return { sub: profile.id, email: profile.email, emailVerified: true };
}

async function verifyGoogleIdToken(token: string, nonce: string): Promise<OidcClaims & { sub: string }> {
  const googleClientId = clientId("google");
  const { payload } = await jwtVerify(token, googleJwks, { issuer: ["https://accounts.google.com", "accounts.google.com"], audience: googleClientId });
  if (typeof payload.sub !== "string" || payload.nonce !== nonce || (payload.azp !== undefined && payload.azp !== googleClientId)) {
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
      const facebook = provider === "facebook";
      const authorization = new URL(facebook
        ? `https://www.facebook.com/${config.FACEBOOK_GRAPH_API_VERSION}/dialog/oauth`
        : "https://accounts.google.com/o/oauth2/v2/auth");
      authorization.search = new URLSearchParams({
        response_type: "code",
        client_id: clientId(provider),
        redirect_uri: redirectUri,
        scope: facebook ? "email,public_profile" : "openid email",
        state,
        ...(!facebook ? { nonce, code_challenge: challenge, code_challenge_method: "S256" } : {})
      }).toString();
      response.redirect(authorization.toString());
    } catch (error) { next(error); }
  });

  router.get("/:provider/callback", async (request, response) => {
    let providerForLog = "unknown";
    let stage = "validate_request";
    try {
      const provider = request.params.provider as OAuthProvider;
      providerForLog = providers.includes(provider) ? provider : "unknown";
      const state = typeof request.query.state === "string" ? request.query.state : "";
      const code = typeof request.query.code === "string" ? request.query.code : "";
      if (!providers.includes(provider) || !providerReady(provider) || !state || !code || request.query.error) {
        log("warn", `auth.oauth.callback.rejected.${providerForLog}.${request.query.error ? "provider_denied" : "missing_or_unavailable_parameters"}`, { path: "/api/v1/auth/oauth/callback", statusCode: 400 });
        redirectFailure(response, options);
        return;
      }
      stage = "validate_browser_state";
      if (!/^[A-Za-z0-9_-]{43}$/.test(state) || request.cookies?.[oauthStateCookieName(state)] !== state) {
        log("warn", `auth.oauth.callback.rejected.${providerForLog}.browser_state`, { path: "/api/v1/auth/oauth/callback", statusCode: 400 });
        redirectFailure(response, options);
        return;
      }
      response.clearCookie(oauthStateCookieName(state), {
        httpOnly: true,
        secure: options.secureCookie,
        sameSite: "lax",
        path: oauthCookiePath
      });
      stage = "consume_flow";
      const flow = await options.oauthRepository.consumeFlow(state, provider);
      if (!flow) {
        log("warn", `auth.oauth.callback.rejected.${providerForLog}.flow_missing_or_expired`, { path: "/api/v1/auth/oauth/callback", statusCode: 400 });
        redirectFailure(response, options); return;
      }
      stage = "exchange_code";
      const identity = provider === "facebook"
        ? await fetchFacebookIdentity(code, callbackUrl(provider, options))
        : await (async () => {
            const idToken = await exchangeGoogleCode(code, flow.codeVerifier, callbackUrl(provider, options));
            stage = "verify_identity_token";
            const claims = await verifyGoogleIdToken(idToken, flow.nonce);
            return { sub: claims.sub, email: claims.email, emailVerified: verifiedEmail(claims) };
          })();
      const email = identity.email?.trim().toLowerCase();
      stage = "link_account";
      const user = await options.oauthRepository.findOrCreateUser(provider, identity.sub, email, identity.emailVerified);
      if (user.status !== "active") {
        log("warn", `auth.oauth.callback.rejected.${providerForLog}.account_inactive`, { path: "/api/v1/auth/oauth/callback", statusCode: 403 });
        redirectFailure(response, options); return;
      }

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

      stage = "create_session";
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
      log("warn", `auth.oauth.callback.failed.${providerForLog}.${stage}`, { path: "/api/v1/auth/oauth/callback", statusCode: 502 });
      redirectFailure(response, options);
    }
  });

  return router;
}
