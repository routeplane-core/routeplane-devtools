/**
 * `rp cache purge` — clear the tenant's response cache via `POST /v1/cache/purge`.
 */

import { RouteplaneCoreClient } from '@routeplane/sdk/core';
import type { Connection } from '../resolve.js';
import { green } from '../output.js';

export async function runCachePurge(conn: Connection): Promise<void> {
  const client = new RouteplaneCoreClient({ apiKey: conn.apiKey, baseUrl: conn.baseUrl });
  await client.post<unknown>('/v1/cache/purge');
  process.stdout.write(`${green('✓')} Cache purged.\n`);
}
