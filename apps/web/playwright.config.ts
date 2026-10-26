import { defineConfig, devices } from "@playwright/test";

const databaseE2E = process.env.RUN_DATABASE_E2E === "true";
const recommendationFlag = process.env.DOCTOR_RECOMMENDATIONS_ENABLED === "true" ? "true" : "false";
const webPort = Number(process.env.WEB_PORT ?? 3000);
const apiPort = Number(process.env.API_PORT ?? 4000);
const webOrigin = `http://localhost:${webPort}`;
const apiOrigin = `http://localhost:${apiPort}`;
const testDistDir = databaseE2E ? `.next-e2e-db-${webPort}` : `.next-playwright-${webPort}`;

if (databaseE2E) {
  if (process.env.NODE_ENV !== "development") {
    throw new Error("Database E2E requires NODE_ENV=development.");
  }
  let databaseUrl: URL;
  try {
    databaseUrl = new URL(process.env.DATABASE_URL ?? "");
  } catch {
    throw new Error("Database E2E requires a valid DATABASE_URL for the local smart_healthcare database.");
  }
  const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
  const host = databaseUrl.hostname.replace(/^\[|\]$/g, "");
  const databaseName = databaseUrl.pathname.replace(/^\/+/, "");
  if (!new Set(["postgres:", "postgresql:"]).has(databaseUrl.protocol) || !localHosts.has(host) || databaseName !== "smart_healthcare") {
    throw new Error("Database E2E is restricted to localhost and the smart_healthcare database.");
  }
}

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL: databaseE2E ? webOrigin : `http://127.0.0.1:${webPort}`,
    trace: "retain-on-failure",
    // Lets local development use an installed Chrome when the Playwright
    // browser download is unavailable. CI continues to use bundled Chromium.
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : {}
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } }
  ],
  webServer: databaseE2E ? [
    {
      command: "npm run dev -w @healthcare/api",
      url: `${apiOrigin}/health`,
      // Database E2E must start an API with the requested feature-flag value;
      // reusing a pre-existing development API could silently test the wrong mode.
      reuseExistingServer: databaseE2E ? false : !process.env.CI,
      timeout: 120_000,
      cwd: "../..",
      env: { NODE_ENV: "development", API_PORT: String(apiPort), WEB_ORIGIN: webOrigin, DOCTOR_RECOMMENDATIONS_ENABLED: recommendationFlag }
    },
    {
      command: `npm run dev -w @healthcare/web -- --port ${webPort}`,
      url: webOrigin,
      reuseExistingServer: databaseE2E ? false : !process.env.CI,
      timeout: 120_000,
      cwd: "../..",
      env: { NEXT_PUBLIC_API_URL: apiOrigin, NEXT_DIST_DIR: testDistDir }
    }
  ] : {
    command: `npm run dev -- --port ${webPort}`,
    url: `http://127.0.0.1:${webPort}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { NEXT_DIST_DIR: testDistDir }
  }
});
