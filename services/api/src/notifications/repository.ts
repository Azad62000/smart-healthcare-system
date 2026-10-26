import type { Pool } from "pg";
import type { Notification, NotificationEventType, NotificationRepository } from "./types.js";

interface NotificationRow {
  id: string;
  event_type: NotificationEventType;
  appointment_id: string;
  title: string;
  message: string;
  created_at: Date;
  read_at: Date | null;
}

function mapNotification(row: NotificationRow): Notification {
  return {
    id: row.id,
    eventType: row.event_type,
    appointmentId: row.appointment_id,
    title: row.title,
    message: row.message,
    createdAt: row.created_at.toISOString(),
    readAt: row.read_at?.toISOString() ?? null
  };
}

export class PostgresNotificationRepository implements NotificationRepository {
  constructor(private readonly db: Pool) {}

  async listForUser(userId: string): Promise<Notification[]> {
    const { rows } = await this.db.query<NotificationRow>(
      `SELECT id, event_type, appointment_id, title, message, created_at, read_at
       FROM notifications WHERE recipient_user_id=$1 ORDER BY created_at DESC LIMIT 100`,
      [userId]
    );
    return rows.map(mapNotification);
  }

  async markReadForUser(id: string, userId: string): Promise<Notification | undefined> {
    const { rows } = await this.db.query<NotificationRow>(
      `UPDATE notifications SET read_at=COALESCE(read_at, now())
       WHERE id=$1 AND recipient_user_id=$2
       RETURNING id, event_type, appointment_id, title, message, created_at, read_at`,
      [id, userId]
    );
    return rows[0] && mapNotification(rows[0]);
  }
}
