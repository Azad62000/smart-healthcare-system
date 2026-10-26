import type { NotificationRepository } from "./types.js";

export class NotificationService {
  constructor(private readonly repository: NotificationRepository) {}

  listMine(userId: string) { return this.repository.listForUser(userId); }

  async markRead(id: string, userId: string) {
    return this.repository.markReadForUser(id, userId);
  }
}
