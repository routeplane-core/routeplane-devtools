/**
 * Observability tools — health, logs, analytics, and the FinOps usage/cost
 * surfaces. All read-only.
 */

import {
  type ToolDef,
  EMPTY_SCHEMA,
  jsonResult,
  objectSchema,
  optNumber,
  optString,
  num,
  str,
} from './common.js';

function dateRange(args: Record<string, unknown>): Record<string, string> | undefined {
  const params: Record<string, string> = {};
  const from = optString(args, 'from');
  const to = optString(args, 'to');
  if (from) params.from = from;
  if (to) params.to = to;
  return Object.keys(params).length > 0 ? params : undefined;
}

const rangeSchema = objectSchema({
  from: str('Start date (ISO 8601 or YYYY-MM-DD).'),
  to: str('End date (ISO 8601 or YYYY-MM-DD).'),
});

const getStatus: ToolDef = {
  name: 'get_status',
  description: 'Gateway health status, version, and per-provider circuit state.',
  readOnly: true,
  inputSchema: EMPTY_SCHEMA,
  handler: async (make) => jsonResult(await make().get('/status')),
};

const listLogs: ToolDef = {
  name: 'list_logs',
  description: 'Recent request logs.',
  readOnly: true,
  inputSchema: objectSchema({ limit: num('Maximum number of log entries to return.') }),
  handler: async (make, args) => {
    const limit = optNumber(args, 'limit');
    const params = limit !== undefined ? { limit: String(limit) } : undefined;
    return jsonResult(await make().get('/v1/logs', params));
  },
};

const getAnalytics: ToolDef = {
  name: 'get_analytics',
  description: 'Recent usage analytics events.',
  readOnly: true,
  inputSchema: EMPTY_SCHEMA,
  handler: async (make) => jsonResult(await make().get('/analytics')),
};

const getUsage: ToolDef = {
  name: 'get_usage',
  description: 'FinOps usage export (aggregate spend and token counts).',
  readOnly: true,
  inputSchema: EMPTY_SCHEMA,
  handler: async (make) => jsonResult(await make().get('/v1/finops/usage')),
};

const getUsageDaily: ToolDef = {
  name: 'get_usage_daily',
  description: 'Daily usage rollups over an optional date range (enterprise).',
  readOnly: true,
  inputSchema: rangeSchema,
  handler: async (make, args) => jsonResult(await make().get('/v1/finops/usage/daily', dateRange(args))),
};

const getTimeseries: ToolDef = {
  name: 'get_timeseries',
  description: 'Usage timeseries suitable for charting, over an optional date range.',
  readOnly: true,
  inputSchema: rangeSchema,
  handler: async (make, args) => jsonResult(await make().get('/v1/finops/timeseries', dateRange(args))),
};

const getCacheSavings: ToolDef = {
  name: 'get_cache_savings',
  description: 'Response-cache savings rollup (requests and cost avoided).',
  readOnly: true,
  inputSchema: EMPTY_SCHEMA,
  handler: async (make) => jsonResult(await make().get('/v1/finops/cache-savings')),
};

const getSaverMetrics: ToolDef = {
  name: 'get_saver_metrics',
  description: 'Per-saver cost telemetry (cache, difficulty routing, token compression, etc.).',
  readOnly: true,
  inputSchema: EMPTY_SCHEMA,
  handler: async (make) => jsonResult(await make().get('/v1/finops/saver-metrics')),
};

const getLatency: ToolDef = {
  name: 'get_latency',
  description: 'Per-tenant latency statistics.',
  readOnly: true,
  inputSchema: EMPTY_SCHEMA,
  handler: async (make) => jsonResult(await make().get('/analytics/latency')),
};

export const observabilityTools: ToolDef[] = [
  getStatus,
  listLogs,
  getAnalytics,
  getUsage,
  getUsageDaily,
  getTimeseries,
  getCacheSavings,
  getSaverMetrics,
  getLatency,
];
