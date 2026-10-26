export class ChatRateLimiter {
  private readonly windows = new Map<string, { count: number; expiresAt: number }>();

  constructor(private readonly limit = 30, private readonly windowMs = 60_000) {}

  consume(userId: string, now = Date.now()): boolean {
    const current = this.windows.get(userId);
    if (!current || current.expiresAt <= now) {
      this.windows.set(userId, { count: 1, expiresAt: now + this.windowMs });
      if (this.windows.size > 10_000) {
        for (const [key, window] of this.windows) {
          if (window.expiresAt <= now) this.windows.delete(key);
        }
      }
      return true;
    }
    if (current.count >= this.limit) return false;
    current.count += 1;
    return true;
  }
}
