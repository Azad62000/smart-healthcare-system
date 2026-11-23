import { Router } from "express";
import type { ApiResponse, HealthData } from "@healthcare/shared";
import { pool } from "../db/pool.js";

export const healthRouter = Router();

healthRouter.get("/", (_request, response) => {
  const payload: ApiResponse<HealthData> = {
    success: true,
    data: { status: "ok", service: "healthcare-api", timestamp: new Date().toISOString() },
    meta: { requestId: response.locals.requestId }
  };
  response.status(200).json(payload);
});

healthRouter.get("/ready", async (_request, response) => {
  try {
    await pool.query("SELECT 1");
    response.setHeader("Cache-Control", "no-store");
    response.status(200).json({ success: true, data: { status: "ready", database: "ok" }, meta: { requestId: response.locals.requestId } });
  } catch {
    response.setHeader("Cache-Control", "no-store");
    response.status(503).json({ success: false, data: { status: "not_ready", database: "unavailable" }, meta: { requestId: response.locals.requestId } });
  }
});
