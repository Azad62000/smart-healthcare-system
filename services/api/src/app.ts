import cors from "cors";
import express from "express";
import { config } from "./config.js";
import { errorHandler } from "./middleware/error-handler.js";
import { healthRouter } from "./routes/health.js";
import { requestIdMiddleware } from "./middleware/request-id.js";
import { requestLogger } from "./middleware/request-logger.js";
import cookieParser from "cookie-parser";
import { pool } from "./db/pool.js";
import { PostgresAuthRepository } from "./auth/repository.js";
import { createAuthRouter } from "./auth/routes.js";
import { PostgresPatientRepository } from "./patients/repository.js";
import { createPatientRouter } from "./patients/routes.js";
import { sessionCookieName } from "./auth/routes.js";
import { PostgresDoctorRepository } from "./doctors/repository.js";
import { createDoctorRouter } from "./doctors/routes.js";
import { createDoctorRecommendationRouter } from "./recommendations/routes.js";
import { PostgresAppointmentRepository } from "./appointments/repository.js";
import { createAppointmentRouter } from "./appointments/routes.js";
import { PostgresRecordRepository } from "./records/repository.js";
import { createRecordRouter } from "./records/routes.js";
import { PostgresNotificationRepository } from "./notifications/repository.js";
import { createNotificationRouter } from "./notifications/routes.js";
import { PostgresAnalyticsRepository } from "./analytics/repository.js";
import { createAnalyticsRouter } from "./analytics/routes.js";
import { createAdminUserRouter, PostgresAdminUserRepository } from "./admin/users.js";
import { createAdminServicesRouter } from "./admin/services.js";
import { PostgresPrescriptionRepository } from "./prescriptions/repository.js";
import { createPrescriptionRouter } from "./prescriptions/routes.js";
import { createAiRouter } from "./ai/routes.js";
import { createChatRouter } from "./chat/routes.js";
import { PostgresChatRepository } from "./chat/repository.js";
import { ChatRateLimiter } from "./chat/rate-limiter.js";
import { chatRealtime } from "./chat/realtime.js";
import { PostgresAdminMfaRepository } from "./auth/admin-mfa-repository.js";
import { PostgresEmailCodeRepository } from "./auth/email-code-repository.js";
import { PostgresOAuthRepository } from "./auth/oauth-repository.js";
import { PostgresLoginAttemptLimiter } from "./auth/login-rate-limiter.js";
import { PostgresAdminAppointmentRepository } from "./appointments/admin-repository.js";
import { createAdminAppointmentRouter } from "./appointments/admin-routes.js";
import { createTeleconsultationRouter } from "./teleconsultations/routes.js";
import { createAppointmentDocumentRouter } from "./documents/routes.js";
import { PostgresAppointmentDocumentRepository } from "./documents/types.js";
import { PrivateDocumentStorage } from "./documents/storage.js";
import { MedicalDataCrypto } from "./medical-data-crypto.js";
import { createFeedbackRouter } from "./feedback/routes.js";
import { PostgresFeedbackRepository } from "./feedback/repository.js";

const medicalDataCrypto = MedicalDataCrypto.fromConfiguration(config.MEDICAL_DATA_ENCRYPTION_KEYS);
export const app = express();
app.disable("x-powered-by");
app.set("trust proxy", config.TRUSTED_PROXY_ADDRESSES);
app.use(cors({ origin: config.WEB_ORIGIN, credentials: true }));
app.use(requestIdMiddleware);
app.use(requestLogger);
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());
app.get("/", (_request, response) => response.status(200).json({ success: true, data: { service: "healthcare-api" }, meta: { requestId: response.locals.requestId } }));
app.use("/health", healthRouter);
app.use("/api/v1/auth", createAuthRouter(new PostgresAuthRepository(pool), {
  sessionTtlHours: config.SESSION_TTL_HOURS,
  secureCookie: config.SESSION_COOKIE_SECURE,
  mfaRepository: new PostgresAdminMfaRepository(pool),
  mfaEncryptionKey: config.ADMIN_MFA_ENCRYPTION_KEY,
  emailCodeRepository: new PostgresEmailCodeRepository(pool),
  oauthRepository: new PostgresOAuthRepository(pool),
  loginAttemptLimiter: new PostgresLoginAttemptLimiter(pool, config.AUTH_OTP_PEPPER ?? "local-development-only-rate-limit-key"),
  webOrigin: config.WEB_ORIGIN,
  apiPublicUrl: config.API_PUBLIC_URL
}));
app.use("/api/v1/patients", createPatientRouter(
  new PostgresAuthRepository(pool),
  new PostgresPatientRepository(pool),
  sessionCookieName
));
const allowSyntheticDoctors = config.NODE_ENV !== "production";
const doctorRepository = new PostgresDoctorRepository(pool, allowSyntheticDoctors);
const appointmentRepository = new PostgresAppointmentRepository(pool, allowSyntheticDoctors);
app.use("/api/v1/doctors", createDoctorRouter(
  new PostgresAuthRepository(pool),
  doctorRepository,
  sessionCookieName
));
app.use("/api/v1/doctors/recommendations", createDoctorRecommendationRouter(
  new PostgresAuthRepository(pool),
  doctorRepository,
  appointmentRepository,
  sessionCookieName,
  config.DOCTOR_RECOMMENDATIONS_ENABLED
));
app.use("/api/v1/appointments", createAppointmentRouter(
  new PostgresAuthRepository(pool),
  appointmentRepository,
  sessionCookieName
));
app.use("/api/v1/feedback", createFeedbackRouter(
  new PostgresAuthRepository(pool),
  new PostgresFeedbackRepository(pool),
  sessionCookieName
));
app.use("/api/v1", createAppointmentDocumentRouter(
  new PostgresAuthRepository(pool),
  appointmentRepository,
  new PostgresAppointmentDocumentRepository(pool),
  new PrivateDocumentStorage(config.DOCUMENT_STORAGE_DIR ?? ".private-documents", config.DOCUMENT_MAX_BYTES, medicalDataCrypto),
  sessionCookieName
));
app.use("/api/v1/teleconsultations", createTeleconsultationRouter(
  new PostgresAuthRepository(pool),
  pool,
  sessionCookieName
));
app.use("/api/v1/admin/appointments", createAdminAppointmentRouter(
  new PostgresAuthRepository(pool),
  new PostgresAdminAppointmentRepository(pool, allowSyntheticDoctors),
  sessionCookieName
));
app.use("/api/v1/records", createRecordRouter(
  new PostgresAuthRepository(pool),
  new PostgresRecordRepository(pool),
  appointmentRepository,
  doctorRepository,
  sessionCookieName
));
app.use("/api/v1/prescriptions", createPrescriptionRouter(
  new PostgresAuthRepository(pool),
  new PostgresPrescriptionRepository(pool),
  appointmentRepository,
  doctorRepository,
  sessionCookieName
));
app.use("/api/v1/ai", createAiRouter(new PostgresAuthRepository(pool), sessionCookieName));
export const chatAuthRepository = new PostgresAuthRepository(pool);
export const chatRepository = new PostgresChatRepository(pool, medicalDataCrypto);
export const chatRateLimiter = new ChatRateLimiter();
app.use("/api/v1/chat", createChatRouter(chatAuthRepository, chatRepository, sessionCookieName, chatRealtime, chatRateLimiter));
app.use("/api/v1/notifications", createNotificationRouter(
  new PostgresAuthRepository(pool),
  new PostgresNotificationRepository(pool),
  sessionCookieName
));
app.use("/api/v1/analytics", createAnalyticsRouter(
  new PostgresAuthRepository(pool),
  new PostgresAnalyticsRepository(pool),
  sessionCookieName
));
app.use("/api/v1/admin/users", createAdminUserRouter(new PostgresAuthRepository(pool), new PostgresAdminUserRepository(pool), sessionCookieName));
app.use("/api/v1/admin/services", createAdminServicesRouter(
  new PostgresAuthRepository(pool),
  async () => { await pool.query("SELECT 1"); },
  sessionCookieName
));
app.use((_request, response) => response.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Route not found" }, meta: { requestId: response.locals.requestId } }));
app.use(errorHandler);
