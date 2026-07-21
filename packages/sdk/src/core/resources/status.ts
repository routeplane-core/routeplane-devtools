/** Gateway status resource (`GET /status` — served at the base URL root, not `/v1`). */

import type { RouteplaneCoreClient } from '../client.js';
import type { GatewayStatus } from '../models.js';

export class StatusResource {
  constructor(private readonly client: RouteplaneCoreClient) {}

  /** Gateway health, version, and per-provider circuit state. */
  get(): Promise<GatewayStatus> {
    return this.client.get<GatewayStatus>('/status');
  }
}
