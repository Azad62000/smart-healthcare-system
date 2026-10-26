import { Router } from "express";
import type { AuthRepository } from "../auth/repository.js";
import { requireAuthenticated, requireRoles } from "../auth/authorization.js";
import { log } from "../logger.js";

type ServiceStatus = "healthy" | "unavailable" | "not_configured";
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
    services[0]!.responseTimeMs = Math.round(performance.now() - apiStartedAt);
    response.json({ success: true, data: { services }, meta: { requestId: response.locals.requestId } });
  });
  return router;
}
