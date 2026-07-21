/**
 * `rp providers list` — the custom (self-registered) OpenAI-compatible
 * providers via `GET /v1/providers`. Table of name / base URL / status;
 * `--json` / `--output json` prints raw.
 */

import { RouteplaneCoreClient, type Provider } from '@routeplane/sdk/core';
import type { Connection, OutputFormat } from '../resolve.js';
import { printJson, printTable } from '../output.js';

export async function runProvidersList(conn: Connection, output: OutputFormat): Promise<void> {
  const client = new RouteplaneCoreClient({ apiKey: conn.apiKey, baseUrl: conn.baseUrl });
  const body = await client.get<{ data?: Provider[] }>('/v1/providers');
  const providers = body.data ?? [];

  if (output === 'json') {
    printJson(body);
    return;
  }

  if (providers.length === 0) {
    process.stdout.write('No providers found.\n');
    return;
  }

  const rows = providers.map((p) => [
    p.name ?? '',
    p.base_url ?? '',
    typeof p.status === 'string' ? p.status : '',
  ]);
  printTable(['NAME', 'BASE_URL', 'STATUS'], rows);
}
