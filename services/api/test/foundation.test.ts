import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import request from "supertest";
import { app } from "../src/app.js";
import { parseEnvironment as parseRawEnvironment } from "../src/config.js";
import { log } from "../src/logger.js";
import { validateRequest } from "../src/middleware/validate-request.js";
import { ApiRequestError } from "../src/request-error.js";
import express from "express";
import { errorHandler } from "../src/middleware/error-handler.js";
import { requestIdMiddleware } from "../src/middleware/request-id.js";

afterEach(() => vi.restoreAllMocks());

const parseEnvironment = (environment: NodeJS.ProcessEnv) => parseRawEnvironment({
  MEDICAL_DATA_ENCRYPTION_KEYS: `test-key:${"a".repeat(64)}`,
  ...environment
});

describe("validated environment", () => {
  it("applies safe defaults and rejects invalid or undeclared settings", () => {
    expect(parseEnvironment({
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://localhost:5432/test",
      API_PUBLIC_URL: "https://api.example.test",
      WEB_ORIGIN: "https://app.example.test",
      SESSION_COOKIE_SECURE: "true"
    }).success).toBe(true);
    expect(parseEnvironment({
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://localhost:5432/test",
      API_PUBLIC_URL: "http://api.example.test",
      WEB_ORIGIN: "http://app.example.test"
    }).success).toBe(false);
    const defaults = parseEnvironment({ DATABASE_URL: "postgresql://healthcare:test@localhost:5432/test" });
    expect(defaults.success).toBe(true);
    const productionHttps = {
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://localhost:5432/test",
      API_PUBLIC_URL: "https://api.example.test",
      WEB_ORIGIN: "https://app.example.test",
      SESSION_COOKIE_SECURE: "true"
    };
    expect(parseEnvironment({ ...productionHttps, LIVEKIT_URL: "ws://video.example.test" }).success).toBe(false);
    expect(parseEnvironment({ ...productionHttps, LIVEKIT_URL: "wss://video.example.test" }).success).toBe(true);
    if (defaults.success) {
      expect(defaults.data.API_PORT).toBe(4000);
      expect(defaults.data.DOCTOR_RECOMMENDATIONS_ENABLED).toBe(false);
    }
    const enabled = parseEnvironment({ DATABASE_URL: "postgresql://healthcare:test@localhost:5432/test", DOCTOR_RECOMMENDATIONS_ENABLED: "true" });
    expect(enabled.success && enabled.data.DOCTOR_RECOMMENDATIONS_ENABLED).toBe(true);

    expect(parseEnvironment({ API_PORT: "99999", DATABASE_URL: "postgresql://healthcare:test@localhost:5432/test" }).success).toBe(false);
    expect(parseEnvironment({ DATABASE_URL: "not-a-url" }).success).toBe(false);
    expect(parseEnvironment({ DATABASE_URL: "postgresql://healthcare:test@localhost:5432/test", DOCTOR_RECOMMENDATIONS_ENABLED: "yes" }).success).toBe(false);
  });
});

describe("medical-data encryption configuration", () => {
  it("requires a valid dedicated keyring and rejects repeated key IDs", () => {
    expect(parseRawEnvironment({ DATABASE_URL: "postgresql://localhost:5432/test" }).success).toBe(false);
    expect(parseRawEnvironment({
      DATABASE_URL: "postgresql://localhost:5432/test",
      MEDICAL_DATA_ENCRYPTION_KEYS: "malformed"
    }).success).toBe(false);
    expect(parseRawEnvironment({
      DATABASE_URL: "postgresql://localhost:5432/test",
      MEDICAL_DATA_ENCRYPTION_KEYS: `key:${"a".repeat(64)},key:${"b".repeat(64)}`
    }).success).toBe(false);
  });
});

describe("API foundation responses", () => {
  it("attaches a generated request ID to response and response metadata", async () => {
    const response = await request(app).get("/health");
    expect(response.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/i);
    expect(response.body.meta.requestId).toBe(response.headers["x-request-id"]);
  });

  it("keeps internal exception details out of the generic error response", async () => {
    const testApp = express();
    testApp.use(requestIdMiddleware);
    testApp.get("/failure", () => { throw new Error("patient diagnosis or credential secret"); });
    testApp.use(errorHandler);
    const response = await request(testApp).get("/failure");
    expect(response.status).toBe(500);
    expect(response.body).toMatchObject({ success: false, error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred" } });
    expect(JSON.stringify(response.body)).not.toContain("diagnosis");
    expect(JSON.stringify(response.body)).not.toContain("credential");
  });

  it("returns sanitized validation errors without echoing invalid values", async () => {
    const testApp = express();
    testApp.use(express.json());
    testApp.use(requestIdMiddleware);
    testApp.post("/sample", validateRequest({ body: z.object({ age: z.number().int().positive() }) }), (_req, res) => res.json(res.locals.validated));
    testApp.use(errorHandler);
    const response = await request(testApp).post("/sample").send({ age: "sensitive-invalid-input" });
    expect(response.status).toBe(400);
    expect(response.body.error).toMatchObject({ code: "VALIDATION_ERROR", message: "The request could not be accepted.", details: [{ field: "body.age", issue: "Invalid value" }] });
    expect(JSON.stringify(response.body)).not.toContain("sensitive-invalid-input");
  });

  it("formats known safe request errors using the common envelope", async () => {
    const testApp = express();
    testApp.use(requestIdMiddleware);
    testApp.get("/conflict", (_req, _res, next) => next(new ApiRequestError(409, "CONFLICT", "Appointment is no longer available.")));
    testApp.use(errorHandler);
    const response = await request(testApp).get("/conflict");
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("CONFLICT");
  });
});

describe("structured logger", () => {
  it("emits JSON with allowlisted metadata and strips query parameters", () => {
    const output = vi.spyOn(console, "log").mockImplementation(() => undefined);
    log("info", "http.request.completed", { path: "/patients?token=secret", method: "GET", statusCode: 200 });
    const record = JSON.parse(String(output.mock.calls[0][0]));
    expect(record.path).toBe("/patients");
    expect(JSON.stringify(record)).not.toContain("secret");
    expect(record.statusCode).toBe(200);
  });
});
