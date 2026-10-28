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

  async listPageForUser(userId: string, options: { limit: number; beforeCreatedAt?: string; beforeId?: string }) {
    const [page, count] = await Promise.all([
      this.db.query<NotificationRow>(
        `SELECT id, event_type, appointment_id, title, message, created_at, read_at
         FROM notifications WHERE recipient_user_id=$1
           AND ($2::timestamptz IS NULL OR (created_at,id)<($2::timestamptz,$3::uuid))
         ORDER BY created_at DESC,id DESC LIMIT $4`,
        [userId, options.beforeCreatedAt ?? null, options.beforeId ?? null, options.limit + 1]
      ),
      this.db.query<{ count: string }>("SELECT count(*)::text AS count FROM notifications WHERE recipient_user_id=$1 AND read_at IS NULL", [userId])
    ]);
    const hasMore = page.rows.length > options.limit;
    const rows = page.rows.slice(0, options.limit);
    const last = rows.at(-1);
    return {
      notifications: rows.map(mapNotification),
      unreadCount: Number(count.rows[0]?.count ?? "0"),
      nextCursor: hasMore && last ? { createdAt: last.created_at.toISOString(), id: last.id } : null
    };
  }

  async listForUser(userId: string): Promise<Notification[]> {
    const page = await this.listPageForUser(userId, { limit: 100 });
    return page.notifications;
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
