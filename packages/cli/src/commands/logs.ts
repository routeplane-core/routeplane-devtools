/**
 * `rp logs` — recent request logs via `GET /v1/logs`.
 *
 * Table of timestamp / model / provider / status / latency / tokens (newest
 * first, as the gateway returns them); `--json` / `--output json` prints raw.
 */

import { RouteplaneCoreClient, type LogEntry } from '@routeplane/sdk/core';
import type { Connection, OutputFormat } from '../resolve.js';
import { printJson, printTable } from '../output.js';

/** Extract a token count from the row's typed field, a bare `tokens`, or nested `usage`. */
function tokensOf(entry: LogEntry): string {
  const direct = entry.tokens ?? entry.total_tokens;
  if (typeof direct === 'number') return String(direct);
  const usage = entry.usage as { total_tokens?: unknown } | undefined;
  if (usage && typeof usage.total_tokens === 'number') return String(usage.total_tokens);
  return '';
}

export async function runLogs(conn: Connection, output: OutputFormat, limit?: number): Promise<void> {
  const client = new RouteplaneCoreClient({ apiKey: conn.apiKey, baseUrl: conn.baseUrl });
  const params = limit !== undefined ? { limit: String(limit) } : undefined;
  const body = await client.get<{ events?: LogEntry[] }>('/v1/logs', params);
  const events = body.events ?? [];

  if (output === 'json') {
    printJson(body);
    return;
  }

  if (events.length === 0) {
    process.stdout.write('No logs found.\n');
    return;
  }

  const rows = events.map((e) => [
    e.timestamp ?? '',
    e.model ?? '',
    e.provider ?? '',
    e.status !== undefined ? String(e.status) : '',
    e.latency_ms !== undefined ? String(e.latency_ms) : '',
    tokensOf(e),
  ]);
  printTable(['TIMESTAMP', 'MODEL', 'PROVIDER', 'STATUS', 'LATENCY(ms)', 'TOKENS'], rows);
}
