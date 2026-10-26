import { Router } from "express";
import type { AuthRepository } from "../auth/repository.js";
import { requireAuthenticated, requireRoles } from "../auth/authorization.js";
import { isEmailDeliveryConfigured } from "../auth/email.js";
import { log } from "../logger.js";
import { config } from "../config.js";

type ServiceStatus = "healthy" | "unavailable" | "not_configured" | "configured";
type ServiceHealth = { name: string; status: ServiceStatus; checkedAt: string; responseTimeMs: number | null; detail: string };

export function createAdminServicesRouter(auth: AuthRepository, checkDatabase: () => Promise<void>, cookieName: string): Router {
  const router = Router();
  router.use(requireAuthenticated(auth, cookieName), requireRoles("Admin"));
  router.get("/", async (_request, response) => {
    const apiStartedAt = performance.now();
    const services: ServiceHealth[] = [{
      name: "Healthcare API",
      status: "healthy" as ServiceStatus,
      checkedAt: new Date().toISOString(),
      responseTimeMs: null,
      detail: "This endpoint is responding."
    }];
    const startedAt = performance.now();
    const checkedAt = new Date();
    try {
      await checkDatabase();
      services.push({
        name: "PostgreSQL",
        status: "healthy",
        checkedAt: checkedAt.toISOString(),
        responseTimeMs: Math.round(performance.now() - startedAt),
        detail: "Database query succeeded."
      });
    } catch (error) {
      const errorCode = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : "unknown";
      log("warn", `admin.postgresql_health_check.failed.${errorCode}`);
      services.push({
        name: "PostgreSQL",
        status: "unavailable",
        checkedAt: checkedAt.toISOString(),
        responseTimeMs: Math.round(performance.now() - startedAt),
        detail: "Database health check failed."
      });
    }
    services.push({
      name: "AI inference",
      status: "not_configured",
      checkedAt: new Date().toISOString(),
      responseTimeMs: null,
      detail: "No AI inference adapter is configured."
    });
    const optionalIntegrations: Array<{ name: string; configured: boolean; readyDetail: string; missingDetail: string }> = [
      {
        name: "SMTP email delivery",
        configured: isEmailDeliveryConfigured(),
        readyDetail: "SMTP and email-code security settings are present; delivery connectivity has not been tested.",
        missingDetail: "SMTP host, port, sender, and AUTH_OTP_PEPPER are required for email-code delivery."
      },
      {
        name: "Google sign-in",
        configured: Boolean(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET),
        readyDetail: "Google OAuth credentials are present; provider sign-in has not been tested.",
        missingDetail: "Google OAuth client credentials are not configured."
      },
      {
        name: "Apple sign-in",
        configured: Boolean(config.APPLE_CLIENT_ID && config.APPLE_TEAM_ID && config.APPLE_KEY_ID && config.APPLE_PRIVATE_KEY),
        readyDetail: "Apple OAuth credentials are present; provider sign-in has not been tested.",
        missingDetail: "Apple OAuth client settings are not configured."
      },
      {
        name: "LiveKit video",
        configured: Boolean(config.LIVEKIT_URL && config.LIVEKIT_API_KEY && config.LIVEKIT_API_SECRET),
        readyDetail: "LiveKit settings are present; provider connectivity has not been tested.",
        missingDetail: "LiveKit URL, API key, and API secret are not all configured."
      }
    ];
    for (const integration of optionalIntegrations) {
      services.push({
        name: integration.name,
        status: integration.configured ? "configured" : "not_configured",
        checkedAt: new Date().toISOString(),
        responseTimeMs: null,
        detail: integration.configured ? integration.readyDetail : integration.missingDetail
      });
    }
    services[0]!.responseTimeMs = Math.round(performance.now() - apiStartedAt);
    response.json({ success: true, data: { services }, meta: { requestId: response.locals.requestId } });
  });
  return router;
}
