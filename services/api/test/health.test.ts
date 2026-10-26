import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";

describe("health endpoint", () => {
  it("returns a healthy service response", async () => {
    const response = await request(app).get("/health");
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ success: true, data: { status: "ok", service: "healthcare-api" } });
    expect(Number.isNaN(Date.parse(response.body.data.timestamp))).toBe(false);
  });

  it("returns a consistent not found response for unknown routes", async () => {
    const response = await request(app).get("/missing");
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
  });
});
