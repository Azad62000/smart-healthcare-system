import type { NotificationRepository } from "./types.js";

export class NotificationService {
  constructor(private readonly repository: NotificationRepository) {}

  async listMine(userId: string, options: { limit: number; beforeCreatedAt?: string; beforeId?: string }) {
    if (this.repository.listPageForUser) return this.repository.listPageForUser(userId, options);
    const notifications = await this.repository.listForUser(userId);
    const unreadCount = notifications.filter((item) => !item.readAt).length;
    const filtered = options.beforeCreatedAt
      ? notifications.filter((item) => item.createdAt < options.beforeCreatedAt! || (item.createdAt === options.beforeCreatedAt && item.id < (options.beforeId ?? "")))
      : notifications;
    const page = filtered.slice(0, options.limit);
    const last = page.at(-1);
    return { notifications: page, unreadCount, nextCursor: filtered.length > options.limit && last ? { createdAt: last.createdAt, id: last.id } : null };
  }

  async markRead(id: string, userId: string) {
    return this.repository.markReadForUser(id, userId);
  }
}
