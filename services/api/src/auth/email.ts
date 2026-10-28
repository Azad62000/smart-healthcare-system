import nodemailer from "nodemailer";
import { config } from "../config.js";
import { ApiRequestError } from "../request-error.js";

export function isEmailDeliveryConfigured(): boolean {
  return Boolean(config.AUTH_OTP_PEPPER && config.SMTP_HOST && config.SMTP_PORT && config.SMTP_FROM);
}

async function deliverEmail(email: string, subject: string, text: string, failureMessage: string): Promise<void> {
  if (!isEmailDeliveryConfigured() || !config.SMTP_PORT || !config.SMTP_HOST || !config.SMTP_FROM) {
    throw new ApiRequestError(503, "EMAIL_DELIVERY_NOT_CONFIGURED", "Email delivery is not configured.");
  }
  const transporter = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURE,
    ...(config.SMTP_USER && config.SMTP_PASSWORD ? { auth: { user: config.SMTP_USER, pass: config.SMTP_PASSWORD } } : {})
  });
  try {
    await transporter.sendMail({
      from: config.SMTP_FROM_NAME ? { name: config.SMTP_FROM_NAME, address: config.SMTP_FROM } : config.SMTP_FROM,
      to: email,
      subject,
      text,
      textEncoding: "quoted-printable"
    });
  } catch {
    throw new ApiRequestError(503, "EMAIL_DELIVERY_FAILED", failureMessage);
  } finally {
    transporter.close();
  }
}

export async function sendNotificationEmail(email: string, subject: string, text: string): Promise<void> {
  await deliverEmail(email, subject, text, "We could not deliver this notification email.");
}

export async function sendAuthCode(email: string, code: string, purpose: "verify_email" | "password_reset" | "admin_mfa_recovery"): Promise<void> {
  const subject = purpose === "verify_email" ? "Verify your Smart Healthcare email" : purpose === "password_reset" ? "Your Smart Healthcare password reset code" : "Admin authenticator recovery code";
  const action = purpose === "verify_email" ? "verify your email address" : purpose === "password_reset" ? "reset your password" : "reset your Admin authenticator and enroll a new one";
  await deliverEmail(email, subject, `Use this code to ${action}: ${code}\n\nThis code expires in 10 minutes. If you did not request it, you can ignore this email.`, "We could not deliver the email code. Please try again.");
}
