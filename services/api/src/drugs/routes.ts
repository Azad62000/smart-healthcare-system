import { Router } from "express";
import { z } from "zod";
import type { AuthRepository } from "../auth/repository.js";
import { requireAuthenticated, requireRoles } from "../auth/authorization.js";
import { validateRequest } from "../middleware/validate-request.js";
import { registryGet } from "./registry-client.js";

const lookupSchema = z.object({
  q: z.string().trim().min(3).max(200)
}).strict();

export function createDrugRouter(auth: AuthRepository, cookieName: string): Router {
  const router = Router();
  router.get("/search", requireAuthenticated(auth, cookieName), requireRoles("Patient"), validateRequest({ query: lookupSchema }), async (_request, response, next) => {
    try {
      const { q } = response.locals.validated.query as z.infer<typeof lookupSchema>;
      const params = new URLSearchParams({ query: q, limit: "10", searchBy: "Drugs" });
      const body = await registryGet<{ drugSuggestions?: unknown[] }>(`/api/drug-registry/v1/suggestions?${params}`);
      response.json({ success: true, data: { configured: true, source: "ABDM Drug Registry", results: body.drugSuggestions ?? [] }, meta: { requestId: response.locals.requestId } });
    } catch (error) { next(error); }
  });
  router.get("/details/:brandIdentifier", requireAuthenticated(auth, cookieName), requireRoles("Patient"), async (request, response, next) => {
    try {
      const parsed = z.string().regex(/^\d{5,20}$/).safeParse(request.params.brandIdentifier);
      if (!parsed.success) {
        response.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Enter a valid drug registry identifier." }, meta: { requestId: response.locals.requestId } });
        return;
      }
      const details = await registryGet<Record<string, unknown>>(`/api/drug-registry/v1/brand/${parsed.data}`);
      response.json({ success: true, data: { details, source: "ABDM Drug Registry" }, meta: { requestId: response.locals.requestId } });
    } catch (error) { next(error); }
  });
  router.get("/barcode", requireAuthenticated(auth, cookieName), requireRoles("Patient"), async (request, response, next) => {
    try {
      const parsed = z.string().trim().min(3).max(512).safeParse(request.query.code);
      if (!parsed.success) {
        response.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Enter a valid barcode or QR payload." }, meta: { requestId: response.locals.requestId } });
        return;
      }
      const code = parsed.data;
      const looksLikeUrl = /^https:\/\//i.test(code);
      if (looksLikeUrl) {
        const url = new URL(code);
        const allowedHosts = ["cdsco.gov.in", "cdsco.nic.in", "gov.in"];
        if (allowedHosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) {
          response.json({ success: true, data: { code, verified: false, verificationUrl: url.toString(), message: "This code links to a government-hosted verification page. Open it and check that the displayed pack details match your package." }, meta: { requestId: response.locals.requestId } });
          return;
        }
      }
      response.json({ success: true, data: { code, verified: false, message: "A scanned code was captured. No trusted pack authentication result was available, so authenticity cannot be confirmed." }, meta: { requestId: response.locals.requestId } });
    } catch (error) { next(error); }
  });
  return router;
}
