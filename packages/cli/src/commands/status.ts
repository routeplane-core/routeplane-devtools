/**
 * `rp status` — gateway health via `GET /status`.
 *
 * Table view by default (gateway URL, status, version, per-provider health);
 * `--json` / `--output json` prints the raw response.
 */

import { RouteplaneCoreClient, type StatusResponse } from '@routeplane/sdk/core';
import type { Connection, OutputFormat } from '../resolve.js';
import { green, printJson, printKeyValues, red } from '../output.js';

export async function runStatus(conn: Connection, output: OutputFormat): Promise<void> {
  const client = new RouteplaneCoreClient({ apiKey: conn.apiKey, baseUrl: conn.baseUrl });
  const status = await client.get<StatusResponse>('/status');

  if (output === 'json') {
    printJson(status);
    return;
  }

  const pairs: [string, string][] = [
    ['Routeplane Gateway', conn.baseUrl],
    ['Status', status.status],
  ];
  if (status.version) pairs.push(['Version', status.version]);
  printKeyValues(pairs);

  if (status.providers && status.providers.length > 0) {
    process.stdout.write('\nProviders\n');
    for (const p of status.providers) {
      const mark = p.healthy ? green('●') : red('●');
      const circuit = p.circuit ? ` (${p.circuit})` : '';
      process.stdout.write(`  ${mark} ${p.name}${circuit}\n`);
    }
  }
}
