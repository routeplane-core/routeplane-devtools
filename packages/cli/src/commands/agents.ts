/**
 * `rp agents {runs,events,pending,approve,deny}` — the agentic-security operator
 * surface over `/v1/mcp/*`.
 *
 * - `runs`    → `GET  /v1/mcp/runs`
 * - `events`  → `GET  /v1/mcp/security/events`
 * - `pending` → `GET  /v1/mcp/hitl/pending`
 * - `approve` → `POST /v1/mcp/hitl/approve`
 * - `deny`    → `POST /v1/mcp/hitl/deny`
 *
 * The gateway hides this surface from tenants without the `AgenticSecurity`
 * entitlement, answering 404 rather than a permission error, so every command
 * here translates that into a plain explanation instead of a bare "not found".
 */

import { RouteplaneCoreClient, RouteplaneError } from '@routeplane/sdk/core';
import type { Connection, OutputFormat } from '../resolve.js';
import { printJson, printKeyValues, printTable } from '../output.js';

function client(conn: Connection): RouteplaneCoreClient {
  return new RouteplaneCoreClient({ apiKey: conn.apiKey, baseUrl: conn.baseUrl });
}

const NOT_ENTITLED =
  'This gateway does not expose the agentic-security surface for your key — it needs the AgenticSecurity entitlement.\n';

/**
 * Whether a 404 means the surface is hidden rather than the record missing.
 *
 * Both answer 404, so the status alone cannot tell them apart: the entitlement
 * gate returns the plain string `not found`, while a real miss (no such approval
 * request) returns the structured `{ outcome: 'error', reason }` envelope.
 */
function isNotEntitled(err: unknown): boolean {
  if (!(err instanceof RouteplaneError) || err.status !== 404) return false;
  const body = err.body;
  return body === null || typeof body !== 'object' || !('outcome' in body);
}

/** Run a read, turning the un-entitled 404 into an explanation rather than an error. */
async function read<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (err) {
    if (isNotEntitled(err)) {
      process.stdout.write(NOT_ENTITLED);
      return undefined;
    }
    throw err;
  }
}

function str(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

export async function runAgentsRuns(conn: Connection, output: OutputFormat): Promise<void> {
  const runs = await read(() => client(conn).mcp.listRuns());
  if (runs === undefined) return;

  if (output === 'json') {
    printJson(runs);
    return;
  }
  if (runs.length === 0) {
    process.stdout.write('No agent runs recorded.\n');
    return;
  }
  printTable(
    ['RUN_ID', 'AGENT', 'ITERATIONS', 'COST_MICRO_USD', 'STATUS', 'STOP_REASON'],
    runs.map((r) => [
      str(r.run_id),
      str(r.agent_id),
      str(r.iterations),
      str(r.cost_micro_usd),
      str(r.status),
      str(r.stop_reason),
    ]),
  );
}

export async function runAgentsEvents(conn: Connection, output: OutputFormat): Promise<void> {
  const events = await read(() => client(conn).mcp.securityEvents());
  if (events === undefined) return;

  if (output === 'json') {
    printJson(events);
    return;
  }
  if (events.length === 0) {
    process.stdout.write('No MCP enforcement events recorded.\n');
    return;
  }
  printTable(
    ['TIMESTAMP', 'CATEGORY', 'OUTCOME', 'DETAIL', 'AGENT', 'SERVER', 'TOOL'],
    events.map((e) => [
      str(e.ts),
      str(e.category),
      str(e.outcome),
      str(e.detail),
      str(e.agent),
      str(e.server),
      str(e.tool),
    ]),
  );
}

export async function runAgentsPending(conn: Connection, output: OutputFormat): Promise<void> {
  const pending = await read(() => client(conn).mcp.listPendingHitl());
  if (pending === undefined) return;

  if (output === 'json') {
    printJson(pending);
    return;
  }
  if (pending.length === 0) {
    process.stdout.write('No tool calls are awaiting approval.\n');
    return;
  }
  printTable(
    ['ID', 'AGENT', 'SERVER', 'TOOL', 'RISK_LABELS'],
    pending.map((p) => [
      str(p.id),
      str(p.agent_id),
      str(p.server),
      str(p.tool),
      Array.isArray(p.risk_labels) ? p.risk_labels.join(',') : '',
    ]),
  );
}

export async function runAgentsResolve(
  conn: Connection,
  output: OutputFormat,
  action: 'approve' | 'deny',
  id: string,
  note: string | undefined,
): Promise<void> {
  const mcp = client(conn).mcp;
  let result;
  try {
    result = await (action === 'approve' ? mcp.approveHitl(id, note) : mcp.denyHitl(id, note));
  } catch (err) {
    // A missing approval request is the caller's mistake and keeps its own
    // error; only the hidden-surface 404 gets the entitlement explanation.
    if (isNotEntitled(err)) {
      process.stdout.write(NOT_ENTITLED);
      return;
    }
    throw err;
  }

  if (output === 'json') {
    printJson(result);
    return;
  }
  printKeyValues([
    ['Id', str(result.id) || id],
    ['Status', str(result.status)],
  ]);
}
