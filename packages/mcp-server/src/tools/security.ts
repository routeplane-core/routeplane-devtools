/**
 * Security tools — guardrail/eval telemetry plus the agentic-security MCP
 * gateway surfaces (run steps, run listing, human-in-the-loop decisions).
 */

import {
  type ToolDef,
  EMPTY_SCHEMA,
  jsonResult,
  objectSchema,
  optRecord,
  optString,
  requireString,
  record,
  str,
} from './common.js';

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

const mcpRunStep: ToolDef = {
  name: 'mcp_run_step',
  description:
    'Execute one MCP agent tool-call step through the agentic-security gateway (default-deny policy boundary).',
  inputSchema: objectSchema(
    {
      agent_id: str('The agent identity making the tool call.'),
      tool: str('The tool name to invoke.'),
      server: str('The MCP server the tool belongs to (authorization is per server+tool).'),
      args: record('Arguments to pass to the tool.'),
    },
    ['agent_id', 'tool'],
  ),
  handler: async (make, args) => {
    const agentId = requireString(args, 'agent_id');
    const tool = requireString(args, 'tool');
    const server = optString(args, 'server');
    const toolArgs = optRecord(args, 'args');
    const body: Record<string, unknown> = { agent_id: agentId, tool };
    if (server) body.server = server;
    if (toolArgs) body.args = toolArgs;
    return jsonResult(await make().post('/v1/mcp/run/step', body));
  },
};

const listMcpRuns: ToolDef = {
  name: 'list_mcp_runs',
  description: 'List recent MCP agent runs.',
  readOnly: true,
  inputSchema: EMPTY_SCHEMA,
  handler: async (make) => jsonResult(await make().get('/v1/mcp/runs')),
};

const hitlApprove: ToolDef = {
  name: 'hitl_approve',
  description: 'Approve a pending human-in-the-loop decision.',
  inputSchema: objectSchema({ decision_id: str('The pending decision id.') }, ['decision_id']),
  handler: async (make, args) => {
    const decisionId = requireString(args, 'decision_id');
    return jsonResult(await make().post('/v1/mcp/hitl/approve', { decision_id: decisionId }));
  },
};

const hitlDeny: ToolDef = {
  name: 'hitl_deny',
  description: 'Deny a pending human-in-the-loop decision, with an optional reason.',
  inputSchema: objectSchema(
    {
      decision_id: str('The pending decision id.'),
      reason: str('Optional denial reason.'),
    },
    ['decision_id'],
  ),
  handler: async (make, args) => {
    const decisionId = requireString(args, 'decision_id');
    const reason = optString(args, 'reason');
    const body: Record<string, unknown> = { decision_id: decisionId };
    if (reason) body.reason = reason;
    return jsonResult(await make().post('/v1/mcp/hitl/deny', body));
  },
};

export const securityTools: ToolDef[] = [
  getGuardrailOutcomes,
  getEvaluations,
  mcpRunStep,
  listMcpRuns,
  hitlApprove,
  hitlDeny,
];
