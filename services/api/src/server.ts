import { createServer } from "node:http";
import { app } from "./app.js";
import { chatAuthRepository, chatRateLimiter, chatRepository } from "./app.js";
import { chatRealtime } from "./chat/realtime.js";
import { sessionCookieName } from "./auth/routes.js";
import { config } from "./config.js";
import { log } from "./logger.js";
import { pool } from "./db/pool.js";
import { EmailOutboxWorker } from "./notifications/email-worker.js";

const server = createServer(app);
const emailWorker = new EmailOutboxWorker(pool);
chatRealtime.attach(server, chatAuthRepository, chatRepository, chatRateLimiter, config.WEB_ORIGIN, sessionCookieName);
server.listen(config.API_PORT, config.API_HOST, () => {
  emailWorker.start();
  log("info", "api.server.started");
});
server.on("close", () => emailWorker.stop());
