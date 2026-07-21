/** Response-cache resource (`POST /v1/cache/purge`). */

import type { RouteplaneCoreClient } from '../client.js';

export class CacheResource {
  constructor(private readonly client: RouteplaneCoreClient) {}

  /** Purge the tenant's response cache. */
  async purge(): Promise<void> {
    await this.client.post<unknown>('/v1/cache/purge');
  }
}
