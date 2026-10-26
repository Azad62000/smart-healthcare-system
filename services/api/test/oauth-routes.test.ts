import { createHash } from "node:crypto";
import cookieParser from "cookie-parser";
import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { config } from "../src/config.js";
import { createOAuthRouter } from "../src/auth/oauth-routes.js";
import type { OAuthFlow, OAuthProvider, OAuthRepository } from "../src/auth/oauth-repository.js";
import type { AuthRepository, UserRecord } from "../src/auth/repository.js";

const originalGoogleClientId = config.GOOGLE_CLIENT_ID;
const originalGoogleClientSecret = config.GOOGLE_CLIENT_SECRET;

class MemoryOAuthRepository implements OAuthRepository {
  state = "";
  flow?: OAuthFlow;
  consumeCalls = 0;
  async createFlow(state: string, flow: OAuthFlow) { this.state = state; this.flow = flow; }
  async consumeFlow(state: string, provider: OAuthProvider) {
    this.consumeCalls += 1;
    return state === this.state && provider === this.flow?.provider ? this.flow : undefined;
  }
  async findOrCreateUser(): Promise<UserRecord> { throw new Error("Not expected in authorization-start tests."); }
}

const unusedAuthRepository: AuthRepository = {
  async createPatient() { throw new Error("Not expected in authorization-start tests."); },
  async findByEmail() { return undefined; },
  async findById() { return undefined; },
  async createSession() { throw new Error("Not expected in authorization-start tests."); },
  async findSession() { return undefined; },
  async deleteSession() {}
};

function appWithOAuth(repository: MemoryOAuthRepository) {
  const app = express();
  app.use(cookieParser());
  app.use("/api/v1/auth/oauth", createOAuthRouter({
    authRepository: unusedAuthRepository,
    oauthRepository: repository,
    sessionTtlHours: 12,
    secureCookie: false,
    webOrigin: "http://localhost:3002",
    apiPublicUrl: "http://localhost:4001"
  }));
  return app;
}

afterEach(() => {
  config.GOOGLE_CLIENT_ID = originalGoogleClientId;
  config.GOOGLE_CLIENT_SECRET = originalGoogleClientSecret;
});

describe("OAuth authorization start", () => {
  it("builds a Google authorization URL with state, nonce, and S256 PKCE", async () => {
    config.GOOGLE_CLIENT_ID = "synthetic-client-id";
    config.GOOGLE_CLIENT_SECRET = "synthetic-client-secret";
    const repository = new MemoryOAuthRepository();
    const response = await request(appWithOAuth(repository)).get("/api/v1/auth/oauth/google/start");
    expect(response.status).toBe(302);

    const authorization = new URL(response.headers.location);
    expect(authorization.origin).toBe("https://accounts.google.com");
    expect(authorization.searchParams.get("client_id")).toBe("synthetic-client-id");
    expect(authorization.searchParams.get("redirect_uri")).toBe("http://localhost:4001/api/v1/auth/oauth/google/callback");
    expect(authorization.searchParams.get("state")).toBe(repository.state);
    const stateCookie = response.headers["set-cookie"][0];
    expect(stateCookie).toContain(`healthcare_oauth_${repository.state}=${repository.state}`);
    expect(stateCookie).toContain("Max-Age=600");
    expect(stateCookie).toContain("Path=/api/v1/auth/oauth");
    expect(stateCookie).toContain("HttpOnly");
    expect(stateCookie).toContain("SameSite=Lax");
    expect(authorization.searchParams.get("nonce")).toBe(repository.flow?.nonce);
    expect(repository.flow?.provider).toBe("google");
    expect(authorization.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorization.searchParams.get("code_challenge")).toBe(
      createHash("sha256").update(repository.flow!.codeVerifier).digest("base64url")
    );
  });

  it("returns users to sign-in with an explicit notice when Google credentials are absent", async () => {
    config.GOOGLE_CLIENT_ID = undefined;
    config.GOOGLE_CLIENT_SECRET = undefined;
    const response = await request(appWithOAuth(new MemoryOAuthRepository())).get("/api/v1/auth/oauth/google/start");
    expect(response.status).toBe(302);
    expect(response.headers.location).toBe("http://localhost:3002/signin?oauth=unavailable&provider=google");
  });

  it("rejects callbacks not bound to the browser that started OAuth before consuming the flow", async () => {
    config.GOOGLE_CLIENT_ID = "synthetic-client-id";
    config.GOOGLE_CLIENT_SECRET = "synthetic-client-secret";
    const repository = new MemoryOAuthRepository();
    await request(appWithOAuth(repository)).get("/api/v1/auth/oauth/google/start");
    const callbackUrl = `/api/v1/auth/oauth/google/callback?${new URLSearchParams({
      state: repository.state,
      code: "synthetic-authorization-code"
    })}`;
    const response = await request(appWithOAuth(repository)).get(callbackUrl);

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe("http://localhost:3002/signin?oauth=failed");
    expect(repository.consumeCalls).toBe(0);
  });

  it("rejects an OAuth callback with a mismatched browser state cookie", async () => {
    config.GOOGLE_CLIENT_ID = "synthetic-client-id";
    config.GOOGLE_CLIENT_SECRET = "synthetic-client-secret";
    const repository = new MemoryOAuthRepository();
    await request(appWithOAuth(repository)).get("/api/v1/auth/oauth/google/start");
    const callbackUrl = `/api/v1/auth/oauth/google/callback?${new URLSearchParams({
      state: repository.state,
      code: "synthetic-authorization-code"
    })}`;
    const response = await request(appWithOAuth(repository))
      .get(callbackUrl)
      .set("Cookie", `healthcare_oauth_${repository.state}=different-state`);

    expect(response.status).toBe(302);
    expect(repository.consumeCalls).toBe(0);
  });
});
