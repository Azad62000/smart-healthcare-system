import type { Pool } from "pg";
import { config } from "../config.js";
import { log } from "../logger.js";
import { sendNotificationEmail } from "../auth/email.js";
import { queueAppointmentScheduledEmails } from "./events.js";

interface OutboxEntry { id: string; recipient_user_id: string; subject: string; body: string; attempts: number; }

export class EmailOutboxWorker {
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(private readonly db: Pool) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.process(); }, 10_000);
    this.timer.unref();
    void this.process();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private async process(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.scheduleAppointmentEmails();
      if (!config.SMTP_HOST || !config.SMTP_PORT || !config.SMTP_FROM) return;
      for (let index = 0; index < 20; index += 1) {
        const entry = await this.claim();
        if (!entry) break;
        await this.deliver(entry);
      }
    } catch (error) {
      log("error", "email.outbox.worker_failed");
    } finally { this.running = false; }
  }

  private async scheduleAppointmentEmails(): Promise<void> {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      await queueAppointmentScheduledEmails(client, Boolean(config.LIVEKIT_URL));
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }

  private async claim(): Promise<OutboxEntry | undefined> {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      await client.query("UPDATE email_outbox SET status='failed',next_attempt_at=now(),updated_at=now() WHERE status='sending' AND updated_at<now()-interval '10 minutes'");
      const result = await client.query<OutboxEntry>(
        `WITH candidate AS (
          SELECT id FROM email_outbox
          WHERE status IN ('pending','failed') AND attempts<5 AND next_attempt_at<=now()
          ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1
        )
        UPDATE email_outbox outbox SET status='sending',attempts=outbox.attempts+1,updated_at=now()
        FROM candidate WHERE outbox.id=candidate.id
        RETURNING outbox.id,outbox.recipient_user_id,outbox.subject,outbox.body,outbox.attempts`
      );
      await client.query("COMMIT");
      return result.rows[0];
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }

  private async deliver(entry: OutboxEntry): Promise<void> {
    const result = await this.db.query<{ email: string }>("SELECT email FROM users WHERE id=$1 AND status='active' AND email_verified=true", [entry.recipient_user_id]);
    if (!result.rows[0]) {
      await this.db.query("UPDATE email_outbox SET status='skipped',updated_at=now() WHERE id=$1", [entry.id]);
      return;
    }
    try {
      await sendNotificationEmail(result.rows[0].email, entry.subject, entry.body);
      await this.db.query("UPDATE email_outbox SET status='sent',sent_at=now(),last_error_code=NULL,updated_at=now() WHERE id=$1", [entry.id]);
    } catch {
      const delayMinutes = Math.min(60, 2 ** Math.max(0, entry.attempts - 1));
      await this.db.query(
        `UPDATE email_outbox SET status='failed',next_attempt_at=now()+($2::text || ' minutes')::interval,
         last_error_code='delivery_failed',updated_at=now() WHERE id=$1`,
        [entry.id, delayMinutes]
      );
      log("warn", "email.outbox.delivery_failed");
    }
  }
}
