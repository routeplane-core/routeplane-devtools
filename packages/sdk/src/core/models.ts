/**
 * Response models for the non-OpenAI gateway surfaces exposed by the core
 * resource namespaces (prompts, logs, FinOps, residency, providers, analytics,
 * MCP agentic security).
 *
 * These mirror the gateway's JSON shapes. Fields the gateway is known to return
 * are typed; everything else stays open via an index signature so a gateway that
 * adds fields never breaks a typed read.
 */

import type { StatusResponse } from './types.js';

/** `GET /status` — gateway health, version, and per-provider circuit state. */
export type GatewayStatus = StatusResponse;

/** A stored prompt template (`GET /v1/prompts/{reference}`). */
export interface Prompt {
  reference?: string;
  id?: string;
  version?: string | number;
  template?: string;
  messages?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

/** A rendered prompt (`POST /v1/prompts/{reference}/render`). */
export interface RenderedPrompt {
  reference?: string;
  text?: string;
  messages?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

/** A chat completion produced from a prompt (`POST /v1/prompts/{reference}/completions`). */
export interface Completion {
  id?: string;
  model?: string;
  choices?: Array<Record<string, unknown>>;
  usage?: Record<string, unknown>;
  [key: string]: unknown;
}

/** A single request-log row (`GET /v1/logs` → `events[]`). */
export interface LogEntry {
  request_id?: string;
  provider?: string;
  model?: string;
  status?: number;
  latency_ms?: number;
  timestamp?: string;
  [key: string]: unknown;
}

/** Integer usage/cost totals shared by the recent chargeback groupings. */
export interface FinOpsUsageTotals {
  requests: number;
  successful_requests: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  /** Gateway price-book estimate in integer millionths of a US dollar. */
  cost_micro_usd: number;
  /** ISO-4217 currency → integer minor units (for example INR → paise). */
  cost_by_currency: Record<string, number>;
}

/** Upstream-attempt latency over the recent in-memory sample. */
export interface FinOpsLatencyPercentiles {
  count: number;
  p50_ms?: number;
  p95_ms?: number;
  p99_ms?: number;
  max_ms?: number;
}

/**
 * `GET /v1/finops/usage` — recent, process-local chargeback/showback data.
 *
 * This is an estimate over the gateway's bounded in-memory event ring, not
 * durable history and not a provider invoice or reconciled bill.
 */
export interface UsageData {
  tenant_id: string;
  window: number;
  events_matched: number;
  totals: FinOpsUsageTotals;
  by_model: Record<string, FinOpsUsageTotals>;
  by_key: Record<string, FinOpsUsageTotals>;
  by_use_case?: Record<string, FinOpsUsageTotals>;
  latency: FinOpsLatencyPercentiles;
}

export interface DailyModelUsage {
  provider: string;
  model: string;
  requests: number;
  errors: number;
  total_tokens: number;
  /** Null unless this aggregate has complete, versioned pricing coverage. */
  cost_micro_usd: number | null;
  pricing: DailyPricingEvidence;
}

export interface DailyKeyUsage extends DailyModelUsage {
  key: string;
  prompt_tokens: number;
  completion_tokens: number;
  cost_inr_paise: number | null;
}

export interface DailyPricingSource {
  class: 'durable_rollup';
  systems: ['telemetry_rung_1'];
  schema_version: 'routeplane.finops.cost.v1';
}

export interface DailyPricingCoverage {
  eligible_count: number;
  observed_count: number;
  priced_count: number;
  unpriced_count: number;
  invalid_pricing_count: number;
  versioned_priced_count: number;
  pricing_coverage_state: 'known' | 'legacy_unknown' | 'corrupt';
  pricing_book_versions: string[];
  pricing_book_versions_truncated: boolean;
  numeric_overflowed: boolean;
  missing_reasons: string[];
}

export interface DailyPricingEvidence {
  data_state: 'live' | 'partial' | 'unavailable';
  availability: 'available' | 'partial' | 'unavailable';
  /** Canonical micro-USD total. Numeric zero is valid only when available. */
  value: number | null;
  unit: 'micro_currency';
  currency: 'USD';
  scale: 6;
  cost_status: 'estimated' | 'unpriced' | 'unavailable';
  source: DailyPricingSource;
  coverage: DailyPricingCoverage;
  component_coverage: {
    input_output_split_available: boolean;
    cost_split_coverage_state: 'known' | 'legacy_unknown' | 'corrupt';
    input_attributed_count: number;
    output_attributed_count: number;
    invalid_input_count: number;
    invalid_output_count: number;
    missing_reasons: string[];
    inr_view_available: boolean;
  };
}

export interface DailyUsage {
  date: string;
  requests: number;
  errors: number;
  streaming: number;
  sovereign_routed: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cost_micro_usd: number | null;
  input_cost_micro_usd: number | null;
  output_cost_micro_usd: number | null;
  cost_inr_paise: number | null;
  pricing: DailyPricingEvidence;
  latency_ms: { p50: number | null; p95: number | null; p99: number | null };
  by_model: DailyModelUsage[];
  by_key: DailyKeyUsage[];
}

export interface DailyUsageTotals {
  requests: number;
  errors: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cost_micro_usd: number | null;
  input_cost_micro_usd: number | null;
  output_cost_micro_usd: number | null;
  cost_inr_paise: number | null;
  pricing: DailyPricingEvidence;
}

/** Durable daily estimated usage; still not a billed or reconciled amount. */
export interface DailyUsageReport {
  tenant_id: string;
  from: string;
  to: string;
  days: DailyUsage[];
  totals: DailyUsageTotals;
  note: string;
}

export interface TimeseriesBucket {
  ts: string;
  requests: number;
  errors: number;
  cost_micro_usd: number;
  tokens: number;
  avg_latency_ms: number;
}

/** Recent, process-local time series from the bounded in-memory event ring. */
export interface TimeseriesData {
  tenant_id: string;
  window_mins: number;
  window_secs: number;
  bucket_secs: number;
  total_events_in_window: number;
  buckets: TimeseriesBucket[];
  note: string;
}

/** Recent, estimated response-cache savings; not a billed saving. */
export interface CacheSavings {
  tenant_id: string;
  window_mins: number;
  cache_hits: number;
  cacheable_lookups: number;
  saved_cost_micro_usd: number;
  saved_tokens: number;
  note: string;
}

/** Tenant-scoped cache portion of the recent saver metrics response. */
export interface SaverMetrics {
  tenant_id: string;
  window_mins: number;
  tenant: {
    cache: {
      hits: number;
      misses: number;
      cacheable_lookups: number;
      hit_rate: number;
      saved_cost_micro_usd: number;
      saved_tokens: number;
    };
    note: string;
  };
  /** Saver key → reason no honest aggregate is available yet. */
  not_instrumented: Record<string, string>;
}

/** Residency-decision summary (`GET /v1/residency/summary`). */
export type ResidencySummary = Record<string, unknown>;

/** Residency-decision ledger (`GET /v1/residency/ledger`). */
export interface ResidencyLedger {
  entries: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

/** A custom (self-registered) OpenAI-compatible provider (`GET/POST /v1/providers`). */
export interface Provider {
  name?: string;
  base_url?: string;
  [key: string]: unknown;
}

/** A raw usage event (`GET /analytics`). */
export type AnalyticsEvent = Record<string, unknown>;

/** Per-provider latency aggregates (`GET /analytics/latency`). */
export type LatencyStats = Record<string, unknown>;

// --- Evaluations (`/v1/evaluations/*`) ------------------------------------
//
// Gated on the tenant's `evaluations` entitlement. A tenant without it gets a
// 403, which surfaces here as a `RouteplaneError`.

/** One evaluator's verdict on one case. */
export interface EvalScore {
  /** The closed-vocabulary evaluator code, e.g. `valid_json`. */
  evaluator: string;
  /** Whether the check passed. Absent when the check was skipped. */
  passed?: boolean;
  /** The score in `[0, 1]`. Absent when the check was skipped. */
  score?: number;
  /**
   * Set when the case lacked the input this check needs.
   *
   * A skip is NOT a failure, and it is excluded from the summary's rates —
   * counting it as 0 would blend "we did not check this" into "this was wrong"
   * and read as a quality regression that never happened.
   */
  skipped?: boolean;
  /** Why it was skipped, e.g. `missing_reference`. */
  reason?: string;
}

/** All evaluator verdicts for one case. */
export interface EvalCaseResult {
  /** Your `id` from the request, or the case's index when you sent none. */
  case_id: string;
  scores: EvalScore[];
}

/** Per-evaluator totals across every case in one request. */
export interface EvalEvaluatorSummary {
  evaluator: string;
  /** Cases actually scored (excludes skips). */
  n: number;
  n_passed: number;
  n_skipped: number;
  pass_rate: number;
  mean_score: number;
}

/** `POST /v1/evaluations/score`. */
export interface EvalScoreResponse {
  results: EvalCaseResult[];
  summary: { by_evaluator: EvalEvaluatorSummary[] };
  note?: string;
}

/** One built-in judge rubric. */
export interface Rubric {
  /** The closed-vocabulary code, e.g. `rag_groundedness`. */
  code: string;
  /** Its family: quality, rag, safety, security, trajectory, conversation, image, voice. */
  category: string;
  /** The variables this rubric requires to render. */
  variables: string[];
}

/** `GET /v1/evaluations/rubrics`. */
export interface RubricCatalog {
  rubrics: Rubric[];
  note?: string;
}

export interface EvaluationHistoryRow {
  timestamp: string;
  region: string | null;
  rubric: string;
  judge_variant: string;
  passed: boolean;
  score: number;
  inference_id: string;
}

export interface EvaluationRubricSummary {
  rubric: string;
  judge_variant: string;
  n: number;
  n_passed: number;
  mean_score: number;
}

export interface EvaluationHistorySummary {
  n: number;
  n_passed: number;
  pass_rate: number;
  by_rubric: EvaluationRubricSummary[];
}

/** Durable judge-score history; its summary covers only the returned rows. */
export interface EvaluationsPage {
  tenant_id: string;
  from: string;
  to: string;
  rows: EvaluationHistoryRow[];
  summary: EvaluationHistorySummary;
  note: string;
}

// --- MCP agentic security (`/v1/mcp/*`) -----------------------------------
//
// Every surface below is gated on the tenant's `AgenticSecurity` entitlement.
// A tenant without it does not see the surface at all: the gateway answers 404
// rather than 403, so an un-entitled call raises `RouteplaneError` with status
// 404 and not a deny verdict.

/**
 * A policy decision from an MCP enforcement point (tool-call authorization,
 * tool-result inspection, sampling evaluation).
 *
 * A deny is a normal outcome, not a transport failure — the gateway returns it
 * as HTTP 422 (or 429 for a quota deny), and `McpResource` decodes both into
 * this verdict rather than throwing. `reason` is secret-free by construction:
 * the gateway emits a closed-vocabulary label, never matched content.
 */
export interface McpVerdict {
  outcome: 'allow' | 'deny';
  /** Why the call was refused. Present only on a deny. */
  reason?: string;
  /** Milliseconds until the agent's quota window rolls. Quota denies only. */
  retry_after_ms?: number;
  /** The configured per-window tool-call ceiling. Quota denies only. */
  limit?: number;
  /** The quota window length in milliseconds. Quota denies only. */
  window_ms?: number;
  [key: string]: unknown;
}

/**
 * The verdict of one agent-loop iteration (`POST /v1/mcp/run/step`). An agent
 * runtime must halt on `stop` — the run has hit its iteration ceiling, its cost
 * budget, or an operator kill switch.
 */
export interface McpRunStepDecision {
  decision: 'continue' | 'stop';
  /** Closed-vocab stop reason (e.g. `IterationCeiling`). Present only on stop. */
  reason?: string;
  /** Iterations the run has consumed so far. */
  iterations: number;
  [key: string]: unknown;
}

/** One entry on a run's call graph — an LLM iteration or an authorized tool call. */
export interface McpAgentStep {
  /** Per-run monotonic index, stable across ring eviction. */
  idx: number;
  kind: 'llm_iteration' | 'tool_call' | string;
  server?: string;
  tool?: string;
  /** `ok`/`denied` for iterations, `allow`/`deny` for tool calls. */
  outcome: string;
  cost_micro_usd: number;
  /** Closed-vocab detail code (a detector code or stop reason) — never content. */
  detail?: string;
  [key: string]: unknown;
}

/** One agent-run summary (`GET /v1/mcp/runs` → `runs[]`). Governance metadata only. */
export interface McpRunSummary {
  run_id: string;
  agent_id: string;
  tenant_id: string;
  /** RFC 3339 first-seen timestamp. */
  started_at: string;
  /** RFC 3339 last-step timestamp. */
  updated_at: string;
  iterations: number;
  cost_micro_usd: number;
  status: 'running' | 'stopped' | 'killed' | string;
  stop_reason?: string;
  steps?: McpAgentStep[];
  [key: string]: unknown;
}

/**
 * One MCP enforcement event (`GET /v1/mcp/security/events` → `events[]`).
 * Label-only and secret-free: closed-vocabulary category/outcome/detail codes
 * plus governance identifiers, never tool arguments or matched content.
 */
export interface McpSecurityEvent {
  /** RFC 3339 timestamp. */
  ts: string;
  /** e.g. `mcp_authorize_deny`, `mcp_egress_deny`, `mcp_quota_exceeded`. */
  category: string;
  outcome: string;
  detail?: string;
  tenant_id: string;
  agent?: string;
  server?: string;
  tool?: string;
  [key: string]: unknown;
}

/** A held high-risk tool call awaiting an operator decision (`GET /v1/mcp/hitl/pending`). */
export interface HitlPendingRequest {
  id: string;
  agent_id: string;
  server: string;
  tool: string;
  /** Hash of the argument structure — never the values. */
  arg_shape: string;
  risk_labels: string[];
  status: string;
  created_millis: number;
  expires_millis: number;
  [key: string]: unknown;
}

/** The result of approving or denying a held call (`POST /v1/mcp/hitl/{approve,deny}`). */
export interface HitlResolution {
  id: string;
  status: 'approved' | 'denied' | string;
  [key: string]: unknown;
}

/** Current lifecycle state of a held call (`GET /v1/mcp/hitl/status/{id}`). */
export interface HitlStatus {
  id: string;
  /** `unknown` when the gateway has no such request (expired out of the queue, or never held). */
  status: 'pending' | 'approved' | 'denied' | 'expired' | 'unknown' | string;
  [key: string]: unknown;
}

/**
 * The attested body of a signed action receipt. Content-free by construction:
 * arguments and results are bound by hash, never carried.
 */
export interface ReceiptBody {
  schema_version: number;
  /** Monotonic per-issuer sequence, 1-based from genesis. */
  seq: number;
  agent_id: string;
  run_id: string;
  server: string;
  tool: string;
  /** Hex SHA-256 of the argument structure. */
  arg_shape: string;
  /**
   * The attested decision, as the gateway serializes it. Note the asymmetry
   * with `ReceiptIssueOptions.decision`, which takes the lowercase request form.
   */
  decision: 'Allowed' | 'Denied' | 'HeldForApproval' | string;
  /** Hex SHA-256 of the tool result bytes; empty for a deny or hold. */
  result_hash: string;
  /** RFC 3339 issuance timestamp. */
  timestamp: string;
  [key: string]: unknown;
}

/** A signed, hash-chained action receipt (`POST /v1/mcp/receipt/issue`). */
export interface SignedReceipt {
  body: ReceiptBody;
  /** The previous receipt's `entry_hash`, so a gap or reorder breaks verification. */
  prev_hash: string;
  entry_hash: string;
  /** `PS256` for a Key Vault signer. */
  algorithm: string;
  /** Signer key reference (a Key Vault key URI). */
  key_ref: string;
  signature: string;
  [key: string]: unknown;
}

/** The result of verifying a presented receipt (`POST /v1/mcp/receipt/verify`). */
export interface ReceiptVerification {
  /** True only when every check the reported `mode` covers passed. */
  valid: boolean;
  /**
   * `signature` when the signature itself was checked in-process;
   * `chain_only` when just the hash chain was recomputed (a Key Vault signer is
   * verified offline against the exported public key).
   */
  mode: 'signature' | 'chain_only' | string;
  [key: string]: unknown;
}

/** Whether an agent is under a runaway-loop quarantine (`GET /v1/mcp/anomaly/status/{id}`). */
export interface AnomalyStatus {
  agent_id: string;
  quarantined: boolean;
  [key: string]: unknown;
}

/** The result of lifting a quarantine (`POST /v1/mcp/anomaly/clear`). */
export interface AnomalyClearResult {
  agent_id: string;
  /** True only if the agent existed and was quarantined. */
  cleared: boolean;
  [key: string]: unknown;
}
