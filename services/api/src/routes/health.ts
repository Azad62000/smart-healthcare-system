import { Router } from "express";
import type { ApiResponse, HealthData } from "@healthcare/shared";

export const healthRouter = Router();

healthRouter.get("/", (_request, response) => {
  const payload: ApiResponse<HealthData> = {
    success: true,
    data: { status: "ok", service: "healthcare-api", timestamp: new Date().toISOString() },
    meta: { requestId: response.locals.requestId }
  };
  response.status(200).json(payload);
});
