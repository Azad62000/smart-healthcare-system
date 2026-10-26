import { createServer } from "node:http";
import { app } from "./app.js";
import { chatAuthRepository, chatRateLimiter, chatRepository } from "./app.js";
import { chatRealtime } from "./chat/realtime.js";
import { sessionCookieName } from "./auth/routes.js";
import { config } from "./config.js";
import { log } from "./logger.js";

const server = createServer(app);
chatRealtime.attach(server, chatAuthRepository, chatRepository, chatRateLimiter, config.WEB_ORIGIN, sessionCookieName);
server.listen(config.API_PORT, config.API_HOST, () => {
  log("info", "api.server.started");
});
