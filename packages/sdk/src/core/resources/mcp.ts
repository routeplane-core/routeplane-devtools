/**
 * MCP agentic-security resource (`/v1/mcp/*`) — the policy boundary an agent
 * runtime calls around every tool call.
 *
 * The whole surface is gated on the tenant's `AgenticSecurity` entitlement, and
 * the gateway hides it rather than refusing it: an un-entitled tenant gets 404,
 * which surfaces here as a `RouteplaneError` with status 404.
 *
 * Enforcement points are default-deny, and a deny is a decision rather than a
 * failure — the gateway returns it as HTTP 422 (429 for a quota deny) with a
 * structured body. The verdict methods decode those into an `McpVerdict`
 * instead of throwing, so calling code branches on `outcome` and only has to
 * catch genuine transport or entitlement errors.
 *
 * Reading a verdict is fail-closed: only an explicit allow is an allow, so a
 * response this client cannot parse denies rather than falling through. The
 * default-deny posture has to survive the client, not just the gateway.
 */

import { RouteplaneError, type RouteplaneCoreClient } from '../client.js';
import type {
  AnomalyClearResult,
  AnomalyStatus,
  HitlPendingRequest,
  HitlResolution,
  HitlStatus,
  McpRunStepDecision,
  McpRunSummary,
  McpSecurityEvent,
  McpVerdict,
  ReceiptVerification,
  SignedReceipt,
} from '../models.js';

export interface AuthorizeToolCallOptions {
  /**
   * The acting agent. Optional when the virtual key carries an agent binding —
   * the binding then supplies it, and a value that disagrees with the binding is
   * denied rather than honoured.
   */
  agentId?: string;
  /** The MCP server the tool belongs to. Authorization is per `(server, tool)`. */
  server: string;
  tool: string;
  /** URLs the tool call would reach, checked against the SSRF egress guard. */
  argumentUrls?: string[];
  /** The full tool-call arguments, walked recursively for URLs and scanned for secrets/PII. */
  arguments?: unknown;
  /** The tool manifest observed for `server`. Required when the server is pinned. */
  serverManifest?: string;
  /** Correlates this authorization to a run, recording it on that run's call graph. */
  runId?: string;
}

export interface RunStepOptions {
  /** Optional when the key carries an agent binding — see `AuthorizeToolCallOptions.agentId`. */
  agentId?: string;
  runId: string;
  /** Spend to attribute to this step, in micro-USD. */
  costMicroUsd?: number;
}

export interface SamplingEvaluateOptions {
  /** Optional when the key carries an agent binding — see `AuthorizeToolCallOptions.agentId`. */
  agentId?: string;
  /** The MCP server asking to sample, which must hold the sampling grant. */
  server: string;
  /** The server-authored prompt, classified before any model runs. */
  prompt: string;
}

export interface ReceiptIssueOptions {
  /** Optional when the key carries an agent binding — see `AuthorizeToolCallOptions.agentId`. */
  agentId?: string;
  runId: string;
  server: string;
  tool: string;
  /** Hashed to an argument shape; the values are never stored. */
  arguments?: unknown;
  /** The decision to attest. Lowercase on the way in; the receipt body echoes it capitalized. */
  decision: 'allowed' | 'denied' | 'held';
  /** The tool result bytes to bind by hash. Only the digest is recorded. */
  result?: string;
}

/** Statuses the gateway answers a deny with, rather than failing the request. */
const VERDICT_STATUSES = new Set([422, 429]);

const UNRECOGNIZED = 'unrecognized gateway response';

/** Whether a payload is an object carrying `key` set to one of `values`. */
function hasLiteral(payload: unknown, key: string, values: string[]): boolean {
  if (payload === null || typeof payload !== 'object') return false;
  const actual = (payload as Record<string, unknown>)[key];
  return typeof actual === 'string' && values.includes(actual);
}

/**
 * Read a response as a verdict, fail-closed.
 *
 * Only an explicit `outcome: 'allow' | 'deny'` is honoured. An empty 200, a
 * proxy's error page, a shape the gateway changed under us — anything else
 * reads as a deny, because a policy boundary that opens when it is confused is
 * worse than one that refuses. The unparsed payload rides along under
 * `response` so the cause is still debuggable.
 */
function asVerdict(payload: unknown): McpVerdict {
  if (hasLiteral(payload, 'outcome', ['allow', 'deny'])) return payload as McpVerdict;
  return { outcome: 'deny', reason: UNRECOGNIZED, response: payload };
}

/** The run-step analogue of `asVerdict` — an unreadable answer stops the loop. */
function asRunStep(payload: unknown): McpRunStepDecision {
  if (hasLiteral(payload, 'decision', ['continue', 'stop'])) {
    return payload as McpRunStepDecision;
  }
  return { decision: 'stop', reason: UNRECOGNIZED, iterations: 0, response: payload };
}

/**
 * Decode a structured deny into a value. The gateway signals a policy refusal
 * with a 4xx carrying `{ outcome: 'deny', ... }`; anything else — 404 for an
 * un-entitled tenant, 401 for a bad key, a real transport error — rethrows.
 *
 * Note this deliberately does *not* fail closed: a 422 that carries no verdict
 * is a rejected request (a malformed body), and turning the caller's own bug
 * into a policy deny would hide it. Fail-closed applies to reading a decision
 * the gateway actually made, which is `asVerdict`'s job.
 */
function verdictOrThrow(err: unknown): McpVerdict {
  if (err instanceof RouteplaneError && VERDICT_STATUSES.has(err.status)) {
    if (hasLiteral(err.body, 'outcome', ['deny'])) return err.body as McpVerdict;
  }
  throw err;
}

/** The run-step analogue of `verdictOrThrow` — a refused step reports `decision: 'stop'`. */
function stopOrThrow(err: unknown): McpRunStepDecision {
  if (err instanceof RouteplaneError && err.status === 422) {
    if (hasLiteral(err.body, 'decision', ['stop'])) return err.body as McpRunStepDecision;
  }
  throw err;
}

export class McpResource {
  constructor(private readonly client: RouteplaneCoreClient) {}

  /**
   * Authorize one tool call before the agent makes it. Default-deny: an agent
   * that is not registered, a `(server, tool)` pair outside its grants, a drifted
   * manifest on a pinned server, an argument URL that resolves to an internal
   * address, or an exhausted quota all come back as `outcome: 'deny'`.
   */
  async authorizeToolCall(opts: AuthorizeToolCallOptions): Promise<McpVerdict> {
    const body: Record<string, unknown> = { server: opts.server, tool: opts.tool };
    if (opts.agentId !== undefined) body.agent_id = opts.agentId;
    if (opts.argumentUrls !== undefined) body.argument_urls = opts.argumentUrls;
    if (opts.arguments !== undefined) body.arguments = opts.arguments;
    if (opts.serverManifest !== undefined) body.server_manifest = opts.serverManifest;
    if (opts.runId !== undefined) body.run_id = opts.runId;
    try {
      return asVerdict(await this.client.post<unknown>('/v1/mcp/tool-call/authorize', body));
    } catch (err) {
      return verdictOrThrow(err);
    }
  }

  /**
   * Inspect a tool result before it re-enters the model context. Fail-closed: a
   * secret leak, an injection or role-hijack directive, a residency violation, or
   * an oversized payload withholds the result.
   */
  async inspectToolResult(content: string): Promise<McpVerdict> {
    try {
      return asVerdict(await this.client.post<unknown>('/v1/mcp/tool-result/inspect', { content }));
    } catch (err) {
      return verdictOrThrow(err);
    }
  }

  /**
   * Account one agent-loop iteration against the run's breakers. The runtime must
   * halt the loop when this returns `decision: 'stop'`.
   */
  async runStep(opts: RunStepOptions): Promise<McpRunStepDecision> {
    const body: Record<string, unknown> = { run_id: opts.runId };
    if (opts.agentId !== undefined) body.agent_id = opts.agentId;
    if (opts.costMicroUsd !== undefined) body.cost_micro_usd = opts.costMicroUsd;
    try {
      return asRunStep(await this.client.post<unknown>('/v1/mcp/run/step', body));
    } catch (err) {
      return stopOrThrow(err);
    }
  }

  /** Recent agent-run summaries for the caller's tenant, newest first. */
  async listRuns(): Promise<McpRunSummary[]> {
    const body = await this.client.get<{ runs?: McpRunSummary[] }>('/v1/mcp/runs');
    return body.runs ?? [];
  }

  /** Recent MCP enforcement denials for the caller's tenant, newest first. */
  async securityEvents(): Promise<McpSecurityEvent[]> {
    const body = await this.client.get<{ events?: McpSecurityEvent[] }>('/v1/mcp/security/events');
    return body.events ?? [];
  }

  /**
   * Evaluate a sampling request an MCP server made on an agent's behalf.
   * Default-deny: the server must hold the sampling grant, stay under its rate
   * ceiling, and its prompt must clear the detector chain.
   */
  async evaluateSampling(opts: SamplingEvaluateOptions): Promise<McpVerdict> {
    const body: Record<string, unknown> = { server: opts.server, prompt: opts.prompt };
    if (opts.agentId !== undefined) body.agent_id = opts.agentId;
    try {
      return asVerdict(await this.client.post<unknown>('/v1/mcp/sampling/evaluate', body));
    } catch (err) {
      return verdictOrThrow(err);
    }
  }

  /** Approve a held high-risk tool call. `note` is an operator label, never content. */
  approveHitl(id: string, note?: string): Promise<HitlResolution> {
    const body: Record<string, unknown> = { id };
    if (note !== undefined) body.note = note;
    return this.client.post<HitlResolution>('/v1/mcp/hitl/approve', body);
  }

  /** Deny a held high-risk tool call. */
  denyHitl(id: string, note?: string): Promise<HitlResolution> {
    const body: Record<string, unknown> = { id };
    if (note !== undefined) body.note = note;
    return this.client.post<HitlResolution>('/v1/mcp/hitl/deny', body);
  }

  /** Current lifecycle status of a held call. Reports `unknown` if the gateway has no such request. */
  hitlStatus(id: string): Promise<HitlStatus> {
    return this.client.get<HitlStatus>(`/v1/mcp/hitl/status/${encodeURIComponent(id)}`);
  }

  /** Snapshot of the calls currently awaiting an operator decision. */
  listPendingHitl(): Promise<HitlPendingRequest[]> {
    return this.client.get<HitlPendingRequest[]>('/v1/mcp/hitl/pending');
  }

  /**
   * Issue a signed, chained action receipt attesting one tool-call decision.
   * Fail-closed: with no signer configured the gateway answers 503 rather than
   * emitting an unsigned token, which surfaces as a `RouteplaneError`.
   */
  issueReceipt(opts: ReceiptIssueOptions): Promise<SignedReceipt> {
    const body: Record<string, unknown> = {
      run_id: opts.runId,
      server: opts.server,
      tool: opts.tool,
      decision: opts.decision,
    };
    if (opts.agentId !== undefined) body.agent_id = opts.agentId;
    if (opts.arguments !== undefined) body.arguments = opts.arguments;
    if (opts.result !== undefined) body.result = opts.result;
    return this.client.post<SignedReceipt>('/v1/mcp/receipt/issue', body);
  }

  /** Verify a presented receipt. Check `mode` to see whether the signature was covered. */
  verifyReceipt(receipt: SignedReceipt): Promise<ReceiptVerification> {
    return this.client.post<ReceiptVerification>('/v1/mcp/receipt/verify', receipt);
  }

  /** Whether an agent is under a runaway-loop quarantine. */
  anomalyStatus(agentId: string): Promise<AnomalyStatus> {
    return this.client.get<AnomalyStatus>(
      `/v1/mcp/anomaly/status/${encodeURIComponent(agentId)}`,
    );
  }

  /** Lift an agent's quarantine and reset its loop streak. */
  clearAnomaly(agentId: string): Promise<AnomalyClearResult> {
    return this.client.post<AnomalyClearResult>('/v1/mcp/anomaly/clear', { agent_id: agentId });
  }
}
