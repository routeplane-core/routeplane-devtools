/** Request-log resource (`GET /v1/logs`). */

import type { RouteplaneCoreClient } from '../client.js';
import type { LogEntry } from '../models.js';

export interface LogListOptions {
  /** Maximum number of log entries to return. */
  limit?: number;
}

export class LogResource {
  constructor(private readonly client: RouteplaneCoreClient) {}

  /** List recent request logs (newest-first). */
  async list(opts: LogListOptions = {}): Promise<LogEntry[]> {
    const params = opts.limit !== undefined ? { limit: String(opts.limit) } : undefined;
    const body = await this.client.get<{ events?: LogEntry[] }>('/v1/logs', params);
    return body.events ?? [];
  }
}
