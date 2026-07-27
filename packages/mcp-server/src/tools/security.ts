/**
 * Security tools — guardrail/eval telemetry plus the agentic-security MCP
 * gateway surfaces: the two enforcement points (tool-call authorization and
 * tool-result inspection), sampling defense, run governance, the human-in-the-
 * loop approval queue, signed action receipts, and the enforcement-event feed.
 *
 * Every `/v1/mcp/*` tool needs the tenant's `AgenticSecurity` entitlement. The
 * gateway hides the surface rather than refusing it, so an un-entitled tenant
 * gets a 404 back, not a permission error.
 */

import { RouteplaneError } from '@routeplane/sdk/core';
import type { McpVerdict } from '@routeplane/sdk/core';
import {
  type ToolDef,
  EMPTY_SCHEMA,
  jsonResult,
  num,
  objectSchema,
  optNumber,
  optRecord,
  optString,
  optStringArray,
  requireString,
  record,
  str,
  strArray,
  enumStr,
} from './common.js';

/**
 * Run a policy call, returning the deny body rather than an error result when
 * the gateway refuses. A deny is the enforcement point working — surfacing it
 * as a tool error would tell the assistant the gateway broke, when in fact it
 * answered. Statuses outside the deny envelope (404 un-entitled, 401 bad key)
 * still propagate to the caller's error handling.
 */
async function verdict(call: () => Promise<unknown>): Promise<unknown> {
  try {
    return await call();
  } catch (err) {
    if (err instanceof RouteplaneError && (err.status === 422 || err.status === 429)) {
      const body = err.body;
      if (body !== null && typeof body === 'object' && (body as McpVerdict).outcome === 'deny') {
        return body;
      }
      // run/step reports a refusal as `decision: "stop"` rather than a deny.
      if (body !== null && typeof body === 'object' && 'decision' in body) return body;
    }
    throw err;
  }
}

const getGuardrailOutcomes: ToolDef = {
  name: 'get_guardrail_outcomes',
  description: 'Guardrail detection telemetry (PII masking, blocked checks, verdicts).',
  readOnly: true,
  inputSchema: EMPTY_SCHEMA,
  handler: async (make) => jsonResult(await make().get('/v1/guardrails/outcomes')),
};

const getEvaluations: ToolDef = {
  name: 'get_evaluations',
  description: 'Judge / evaluation scores recorded for recent requests.',
  readOnly: true,
  inputSchema: EMPTY_SCHEMA,
  handler: async (make) => jsonResult(await make().get('/v1/evaluations')),
};

const authorizeToolCall: ToolDef = {
  name: 'authorize_tool_call',
  description:
    'Authorize one MCP tool call before making it (default-deny policy boundary). Returns allow, or deny with a reason when the agent lacks a grant for this server+tool, the pinned manifest drifted, an argument URL fails the SSRF guard, or the agent is out of quota.',
  inputSchema: objectSchema(
    {
      server: str('The MCP server the tool belongs to (a grant for one server never covers another).'),
      tool: str('The tool name to invoke.'),
      agent_id: str('The acting agent. Omit when the key carries an agent binding.'),
      argument_urls: strArray('URLs the tool call would reach, checked against the egress guard.'),
      arguments: record('The full tool-call arguments (walked for nested URLs and scanned for secrets).'),
      server_manifest: str('The tool manifest observed for this server. Required when the server is pinned.'),
      run_id: str('Correlates this call to a run, recording it on that run call graph.'),
    },
    ['server', 'tool'],
  ),
  handler: async (make, args) => {
    const body: Record<string, unknown> = {
      server: requireString(args, 'server'),
      tool: requireString(args, 'tool'),
    };
    const agentId = optString(args, 'agent_id');
    if (agentId !== undefined) body.agent_id = agentId;
    const urls = optStringArray(args, 'argument_urls');
    if (urls !== undefined) body.argument_urls = urls;
    const toolArgs = optRecord(args, 'arguments');
    if (toolArgs !== undefined) body.arguments = toolArgs;
    const manifest = optString(args, 'server_manifest');
    if (manifest !== undefined) body.server_manifest = manifest;
    const runId = optString(args, 'run_id');
    if (runId !== undefined) body.run_id = runId;
    return jsonResult(await verdict(() => make().post('/v1/mcp/tool-call/authorize', body)));
  },
};

const inspectToolResult: ToolDef = {
  name: 'inspect_tool_result',
  description:
    'Inspect a tool result before it re-enters the model context. Fail-closed: a secret leak, injection or role-hijack directive, residency violation, or oversized payload withholds the result.',
  inputSchema: objectSchema({ content: str('The tool-result content to inspect.') }, ['content']),
  handler: async (make, args) => {
    const content = requireString(args, 'content');
    return jsonResult(await verdict(() => make().post('/v1/mcp/tool-result/inspect', { content })));
  },
};

const evaluateSampling: ToolDef = {
  name: 'evaluate_sampling',
  description:
    'Evaluate a sampling request an MCP server made on an agent behalf. Default-deny: the server must hold the sampling grant, stay under its rate ceiling, and its prompt must clear the detector chain.',
  inputSchema: objectSchema(
    {
      server: str('The MCP server originating the sampling request.'),
      prompt: str('The server-authored prompt, classified before any model runs.'),
      agent_id: str('The agent being sampled for. Omit when the key carries an agent binding.'),
    },
    ['server', 'prompt'],
  ),
  handler: async (make, args) => {
    const body: Record<string, unknown> = {
      server: requireString(args, 'server'),
      prompt: requireString(args, 'prompt'),
    };
    const agentId = optString(args, 'agent_id');
    if (agentId !== undefined) body.agent_id = agentId;
    return jsonResult(await verdict(() => make().post('/v1/mcp/sampling/evaluate', body)));
  },
};

const mcpRunStep: ToolDef = {
  name: 'mcp_run_step',
  description:
    'Account one agent-loop iteration against the run breakers (iteration ceiling, cost budget, kill switch). Returns continue, or stop — the runtime must halt the loop on stop.',
  inputSchema: objectSchema(
    {
      run_id: str('The run this iteration belongs to.'),
      agent_id: str('The acting agent. Omit when the key carries an agent binding.'),
      cost_micro_usd: num('Spend to attribute to this step, in micro-USD.'),
    },
    ['run_id'],
  ),
  handler: async (make, args) => {
    const body: Record<string, unknown> = { run_id: requireString(args, 'run_id') };
    const agentId = optString(args, 'agent_id');
    if (agentId !== undefined) body.agent_id = agentId;
    const cost = optNumber(args, 'cost_micro_usd');
    if (cost !== undefined) body.cost_micro_usd = cost;
    return jsonResult(await verdict(() => make().post('/v1/mcp/run/step', body)));
  },
};

const listMcpRuns: ToolDef = {
  name: 'list_mcp_runs',
  description: 'Recent agent-run summaries — iterations, accrued cost, status, and stop reason.',
  readOnly: true,
  inputSchema: EMPTY_SCHEMA,
  handler: async (make) => jsonResult(await make().get('/v1/mcp/runs')),
};

const getMcpSecurityEvents: ToolDef = {
  name: 'get_mcp_security_events',
  description:
    'Recent MCP enforcement events (authorize, egress, quota, result-size, anomaly denials). Closed-vocabulary labels only — never tool arguments or matched content.',
  readOnly: true,
  inputSchema: EMPTY_SCHEMA,
  handler: async (make) => jsonResult(await make().get('/v1/mcp/security/events')),
};

const listPendingHitl: ToolDef = {
  name: 'list_pending_hitl',
  description: 'High-risk tool calls currently held for human approval.',
  readOnly: true,
  inputSchema: EMPTY_SCHEMA,
  handler: async (make) => jsonResult(await make().get('/v1/mcp/hitl/pending')),
};

const hitlStatus: ToolDef = {
  name: 'hitl_status',
  description:
    'Current status of a held tool call: pending, approved, denied, expired, or unknown if the gateway has no such request.',
  readOnly: true,
  inputSchema: objectSchema({ id: str('The approval-request id.') }, ['id']),
  handler: async (make, args) => {
    const id = requireString(args, 'id');
    return jsonResult(await make().get(`/v1/mcp/hitl/status/${encodeURIComponent(id)}`));
  },
};

const hitlApprove: ToolDef = {
  name: 'hitl_approve',
  description: 'Approve a held high-risk tool call, letting the agent proceed.',
  inputSchema: objectSchema(
    {
      id: str('The approval-request id.'),
      note: str('Optional operator note (a label — never content).'),
    },
    ['id'],
  ),
  handler: async (make, args) => {
    const body: Record<string, unknown> = { id: requireString(args, 'id') };
    const note = optString(args, 'note');
    if (note !== undefined) body.note = note;
    return jsonResult(await make().post('/v1/mcp/hitl/approve', body));
  },
};

const hitlDeny: ToolDef = {
  name: 'hitl_deny',
  description: 'Deny a held high-risk tool call.',
  inputSchema: objectSchema(
    {
      id: str('The approval-request id.'),
      note: str('Optional operator note (a label — never content).'),
    },
    ['id'],
  ),
  handler: async (make, args) => {
    const body: Record<string, unknown> = { id: requireString(args, 'id') };
    const note = optString(args, 'note');
    if (note !== undefined) body.note = note;
    return jsonResult(await make().post('/v1/mcp/hitl/deny', body));
  },
};

const issueReceipt: ToolDef = {
  name: 'issue_receipt',
  description:
    'Issue a signed, hash-chained receipt attesting one tool-call decision. Arguments and results are bound by hash, never carried. Fails with 503 when no signer is configured — no unsigned receipt is ever emitted.',
  inputSchema: objectSchema(
    {
      run_id: str('The run the call belonged to.'),
      server: str('The MCP server.'),
      tool: str('The tool name.'),
      decision: enumStr(['allowed', 'denied', 'held'], 'The decision to attest.'),
      agent_id: str('The agent to attest for. Omit when the key carries an agent binding.'),
      arguments: record('The tool-call arguments (hashed to a values-free shape).'),
      result: str('The tool result bytes to bind by hash. Omit for a deny or hold.'),
    },
    ['run_id', 'server', 'tool', 'decision'],
  ),
  handler: async (make, args) => {
    const decision = requireString(args, 'decision');
    if (decision !== 'allowed' && decision !== 'denied' && decision !== 'held') {
      throw new Error('Invalid "decision": expected one of allowed, denied, held.');
    }
    const body: Record<string, unknown> = {
      run_id: requireString(args, 'run_id'),
      server: requireString(args, 'server'),
      tool: requireString(args, 'tool'),
      decision,
    };
    const agentId = optString(args, 'agent_id');
    if (agentId !== undefined) body.agent_id = agentId;
    const toolArgs = optRecord(args, 'arguments');
    if (toolArgs !== undefined) body.arguments = toolArgs;
    const result = optString(args, 'result');
    if (result !== undefined) body.result = result;
    return jsonResult(await make().post('/v1/mcp/receipt/issue', body));
  },
};

export const securityTools: ToolDef[] = [
  getGuardrailOutcomes,
  getEvaluations,
  authorizeToolCall,
  inspectToolResult,
  evaluateSampling,
  mcpRunStep,
  listMcpRuns,
  getMcpSecurityEvents,
  listPendingHitl,
  hitlStatus,
  hitlApprove,
  hitlDeny,
  issueReceipt,
];
