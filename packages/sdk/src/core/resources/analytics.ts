/** Analytics resource (`/analytics` — served at the base URL root, not `/v1`). */

import type { RouteplaneCoreClient } from '../client.js';
import type { AnalyticsEvent, LatencyStats } from '../models.js';

export class AnalyticsResource {
  constructor(private readonly client: RouteplaneCoreClient) {}

  /** Recent raw usage events for the tenant. */
  events(): Promise<AnalyticsEvent[]> {
    return this.client.get<AnalyticsEvent[]>('/analytics');
  }

  /** Per-provider latency statistics. */
  latency(): Promise<LatencyStats> {
    return this.client.get<LatencyStats>('/analytics/latency');
  }
}
