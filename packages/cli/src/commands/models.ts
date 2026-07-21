/**
 * `rp models list` — model catalog via `GET /v1/models`.
 *
 * Table of model id / provider / capabilities by default; `--json` prints the
 * raw response, `--provider` filters by owning provider.
 */

import { RouteplaneCoreClient, type Model, type ModelList } from '@routeplane/sdk/core';
import type { Connection, OutputFormat } from '../resolve.js';
import { printJson, printTable } from '../output.js';

/** A model may carry gateway-specific extras beyond the OpenAI-standard fields. */
interface ModelRow extends Model {
  provider?: string;
  capabilities?: unknown;
}

function providerOf(model: ModelRow): string {
  return model.provider ?? model.owned_by ?? '';
}

function capabilitiesOf(model: ModelRow): string {
  const caps = model.capabilities;
  if (Array.isArray(caps)) return caps.map(String).join(', ');
  if (typeof caps === 'string') return caps;
  return '';
}

export async function runModelsList(
  conn: Connection,
  output: OutputFormat,
  providerFilter?: string,
): Promise<void> {
  const client = new RouteplaneCoreClient({ apiKey: conn.apiKey, baseUrl: conn.baseUrl });
  const list = await client.get<ModelList>('/v1/models');

  let models = (list.data ?? []) as ModelRow[];
  if (providerFilter) {
    const needle = providerFilter.toLowerCase();
    models = models.filter((m) => providerOf(m).toLowerCase() === needle);
  }

  if (output === 'json') {
    printJson(providerFilter ? { object: 'list', data: models } : list);
    return;
  }

  if (models.length === 0) {
    process.stdout.write('No models found.\n');
    return;
  }

  const rows = models.map((m) => [m.id, providerOf(m), capabilitiesOf(m)]);
  printTable(['MODEL', 'PROVIDER', 'CAPABILITIES'], rows);
}
