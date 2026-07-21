/**
 * Config tools — response-cache control and residency-decision inspection.
 */

import { type ToolDef, EMPTY_SCHEMA, jsonResult, textResult } from './common.js';

const purgeCache: ToolDef = {
  name: 'purge_cache',
  description: 'Purge the gateway response cache for this tenant.',
  destructive: true,
  inputSchema: EMPTY_SCHEMA,
  handler: async (make) => {
    const result = await make().post<unknown>('/v1/cache/purge');
    return result === undefined ? textResult('Response cache purged.') : jsonResult(result);
  },
};

const getResidencySummary: ToolDef = {
  name: 'get_residency_summary',
  description: 'Summary of recent sovereign-routing residency decisions.',
  readOnly: true,
  inputSchema: EMPTY_SCHEMA,
  handler: async (make) => jsonResult(await make().get('/v1/residency/summary')),
};

const getResidencyLedger: ToolDef = {
  name: 'get_residency_ledger',
  description: 'Recent entries from the sovereign residency ledger.',
  readOnly: true,
  inputSchema: EMPTY_SCHEMA,
  handler: async (make) => jsonResult(await make().get('/v1/residency/ledger')),
};

export const configTools: ToolDef[] = [purgeCache, getResidencySummary, getResidencyLedger];
