export type NotificationEventType = "created" | "cancelled" | "status_changed" | "doctor_joined";

export interface Notification {
  id: string;
  eventType: NotificationEventType;
  appointmentId: string;
  title: string;
  message: string;
  createdAt: string;
  readAt: string | null;
}

export interface NotificationRepository {
  listForUser(userId: string): Promise<Notification[]>;
  listPageForUser?(userId: string, options: { limit: number; beforeCreatedAt?: string; beforeId?: string }): Promise<{ notifications: Notification[]; unreadCount: number; nextCursor: { createdAt: string; id: string } | null }>;
  markReadForUser(id: string, userId: string): Promise<Notification | undefined>;
}
