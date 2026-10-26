export type NotificationEventType = "created" | "cancelled" | "status_changed";

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
  markReadForUser(id: string, userId: string): Promise<Notification | undefined>;
}
