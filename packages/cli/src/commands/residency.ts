/**
 * `rp residency` — sovereign-routing summary via `GET /v1/residency/summary`.
 *
 * Best-effort per-region table (region / total requests / sovereign %); the
 * summary shape is gateway-defined, so `--json` always shows the exact payload.
 */

import { RouteplaneCoreClient, type ResidencySummary } from '@routeplane/sdk/core';
import type { Connection, OutputFormat } from '../resolve.js';
import { printJson, printKeyValues, printTable } from '../output.js';

type Row = Record<string, unknown>;

function numStr(row: Row, keys: string[]): string {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === 'number') return String(v);
    if (typeof v === 'string' && v.trim() !== '') return v;
  }
  return '';
}

/** Coerce the summary's region breakdown into `[region, total, sovereign_pct]` rows. */
function regionRows(summary: ResidencySummary): string[][] {
  const source = summary.by_region ?? summary.regions ?? summary.residency;
  const rows: string[][] = [];

  if (Array.isArray(source)) {
    for (const item of source) {
      if (item && typeof item === 'object') {
        const o = item as Row;
        rows.push([
          numStr(o, ['region', 'name', 'code']),
          numStr(o, ['total_requests', 'requests', 'count']),
          numStr(o, ['sovereign_pct', 'sovereign_percent', 'pct']),
        ]);
      }
    }
  } else if (source && typeof source === 'object') {
    for (const [region, value] of Object.entries(source as Row)) {
      const o = value && typeof value === 'object' ? (value as Row) : {};
      rows.push([
        region,
        numStr(o, ['total_requests', 'requests', 'count']),
        numStr(o, ['sovereign_pct', 'sovereign_percent', 'pct']),
      ]);
    }
  }
  return rows;
}

/** Top-level scalar fields, used as a fallback when there is no region breakdown. */
function scalarPairs(summary: ResidencySummary): [string, string][] {
  const pairs: [string, string][] = [];
  for (const [key, value] of Object.entries(summary)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      pairs.push([key, String(value)]);
    }
  }
  return pairs;
}

export async function runResidency(conn: Connection, output: OutputFormat): Promise<void> {
  const client = new RouteplaneCoreClient({ apiKey: conn.apiKey, baseUrl: conn.baseUrl });
  const summary = await client.get<ResidencySummary>('/v1/residency/summary');

  if (output === 'json') {
    printJson(summary);
    return;
  }

  const rows = regionRows(summary);
  if (rows.length > 0) {
    printTable(['REGION', 'TOTAL_REQUESTS', 'SOVEREIGN_PCT'], rows);
    return;
  }

  const pairs = scalarPairs(summary);
  if (pairs.length > 0) {
    printKeyValues(pairs);
    return;
  }
  process.stdout.write('No residency data.\n');
}
