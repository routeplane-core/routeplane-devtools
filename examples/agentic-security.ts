// The agentic-security surfaces (`/v1/mcp/*`) — the policy boundary an agent
// runtime wraps around every tool call. Requires the `AgenticSecurity`
// entitlement; without it the gateway hides the surface and every call below
// throws a `RouteplaneError` with status 404.
//
//   npm i @routeplane/sdk
//   npx tsx examples/agentic-security.ts

import { RouteplaneCoreClient } from '@routeplane/sdk/core';

const core = new RouteplaneCoreClient({ apiKey: 'rp_live_...' });

const agentId = 'support-bot';
const runId = 'run-2026-07-27-001';

// 1. Ask the run's breakers whether the loop may take another iteration.
const step = await core.mcp.runStep({ agentId, runId, costMicroUsd: 1200 });
if (step.decision === 'stop') {
  console.log(`Run halted after ${step.iterations} iterations: ${step.reason}`);
  process.exit(0);
}

// 2. Authorize the tool call before making it. A deny is a decision, not an
//    error — it comes back as a verdict rather than a thrown exception.
const verdict = await core.mcp.authorizeToolCall({
  agentId,
  runId,
  server: 'github',
  tool: 'create_issue',
  arguments: { repo: 'acme/api', title: 'Flaky test' },
});
if (verdict.outcome === 'deny') {
  console.log('Refused:', verdict.reason);
  process.exit(0);
}

// ... the runtime makes the actual tool call here ...
const toolResult = '{"issue": 42}';

// 3. Inspect the result before it re-enters the model context.
const inspection = await core.mcp.inspectToolResult(toolResult);
if (inspection.outcome === 'deny') {
  console.log('Result withheld:', inspection.reason);
  process.exit(0);
}

// 4. Attest the decision with a signed, hash-chained receipt. Arguments and
//    results are bound by hash, never carried.
const receipt = await core.mcp.issueReceipt({
  agentId,
  runId,
  server: 'github',
  tool: 'create_issue',
  arguments: { repo: 'acme/api', title: 'Flaky test' },
  decision: 'allowed',
  result: toolResult,
});
console.log('Receipt', receipt.body.seq, receipt.entry_hash);

// --- operator surfaces ----------------------------------------------------

// Recent runs and the enforcement events behind any denials.
console.log('Runs:', (await core.mcp.listRuns()).length);
for (const event of await core.mcp.securityEvents()) {
  console.log(`${event.ts} ${event.category} ${event.detail ?? ''}`);
}

// Work the human-in-the-loop queue for high-risk calls.
for (const held of await core.mcp.listPendingHitl()) {
  console.log(`${held.id}: ${held.agent_id} wants ${held.server}/${held.tool}`);
  await core.mcp.denyHitl(held.id, 'out of scope');
}
