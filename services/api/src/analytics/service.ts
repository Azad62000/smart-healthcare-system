import type { AnalyticsOverview, AnalyticsRepository } from "./types.js";

export class AnalyticsService {
  constructor(private readonly repository: AnalyticsRepository, private readonly clock: () => Date = () => new Date()) {}

  getOverview(): Promise<AnalyticsOverview> {
    return this.repository.getOverview(this.clock());
  }
}
