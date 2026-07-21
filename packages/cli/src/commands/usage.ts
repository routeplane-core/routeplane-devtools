/**
 * `rp usage` — FinOps usage summary.
 *
 * Reads the durable daily rollups (`GET /v1/finops/usage/daily`, which accepts
 * the optional `from`/`to` range) so both the filtered and unfiltered views
 * yield per-day rows; the plain `/v1/finops/usage` aggregate has no date
 * breakdown to tabulate. Prints a per-day table with a totals row; `--json`
 * prints the raw response.
 */

import { RouteplaneCoreClient } from '@routeplane/sdk/core';
import type { Connection, OutputFormat } from '../resolve.js';
import { bold, printJson, printTable } from '../output.js';

export interface UsageOptions {
  from?: string;
  to?: string;
}

type Row = Record<string, unknown>;

function pickStr(row: Row, keys: string[]): string {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === 'string') return v;
    if (typeof v === 'number') return String(v);
  }
  return '';
}

function pickNum(row: Row, keys: string[]): number {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === 'number') return v;
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  }
  return 0;
}

const count = (n: number): string => String(Math.round(n));
const cost = (n: number): string => n.toFixed(4);

export async function runUsage(conn: Connection, output: OutputFormat, opts: UsageOptions): Promise<void> {
  const client = new RouteplaneCoreClient({ apiKey: conn.apiKey, baseUrl: conn.baseUrl });
  const params: Record<string, string> = {};
  if (opts.from !== undefined) params.from = opts.from;
  if (opts.to !== undefined) params.to = opts.to;
  const body = await client.get<{ days?: Row[] }>(
    '/v1/finops/usage/daily',
    Object.keys(params).length > 0 ? params : undefined,
  );
  const days = body.days ?? [];

  if (output === 'json') {
    printJson(body);
    return;
  }

  if (days.length === 0) {
    process.stdout.write('No usage found.\n');
    return;
  }

  const totals = { requests: 0, tokens: 0, cost: 0, cacheHits: 0 };
  const rows = days.map((d) => {
    const requests = pickNum(d, ['requests', 'request_count', 'count', 'total_requests']);
    const tokens = pickNum(d, ['tokens', 'total_tokens']);
    const spend = pickNum(d, ['cost', 'cost_usd', 'spend', 'total_cost']);
    const cacheHits = pickNum(d, ['cache_hits', 'cached', 'cache_hit_count']);
    totals.requests += requests;
    totals.tokens += tokens;
    totals.cost += spend;
    totals.cacheHits += cacheHits;
    return [
      pickStr(d, ['date', 'day', 'date_utc', 'ts']),
      count(requests),
      count(tokens),
      cost(spend),
      count(cacheHits),
    ];
  });

  rows.push([
    bold('TOTAL'),
    bold(count(totals.requests)),
    bold(count(totals.tokens)),
    bold(cost(totals.cost)),
    bold(count(totals.cacheHits)),
  ]);

  printTable(['DATE', 'REQUESTS', 'TOKENS', 'COST', 'CACHE_HITS'], rows);
}
