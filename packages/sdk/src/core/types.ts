/**
 * Typed models for the non-OpenAI surfaces plus the `x-routeplane-*` response
 * metadata every gateway response carries.
 */

export type CacheOutcome = 'hit' | 'miss' | 'bypass';

/**
 * Minimal structural view of a headers object — satisfied by both the DOM
 * `Headers` (from global `fetch`) and the node-fetch-style `Headers` the
 * `openai` SDK hands back from `.withResponse()`. We only ever read via `get`.
 */
export interface HeadersLike {
  get(name: string): string | null;
}

export interface RouteplaneRateLimits {
  requestsLimit?: number;
  requestsRemaining?: number;
  requestsReset?: string;
  tokensLimit?: number;
  tokensRemaining?: number;
  tokensReset?: string;
}

/** Decoded `x-routeplane-*` response headers describing how a request was handled. */
export interface RouteplaneMeta {
  /** Provider that actually served the request. */
  provider?: string;
  /** Correlation id (echoes the request `traceId` when supplied). */
  traceId?: string;
  /** Gateway-assigned request id. */
  requestId?: string;
  /** Response-cache outcome. */
  cache?: CacheOutcome;
  /** Guardrail verdict summary. */
  guardrails?: string;
  /** Whether the request was hedged across providers. */
  hedged?: boolean;
  /** Whether the request was load-shed. */
  shed?: boolean;
  /** Remaining spend budget. */
  budgetRemaining?: string;
  /** Budget threshold warning, if any. */
  budgetWarning?: string;
  /** Compliance/residency warning, if any. */
  complianceWarning?: string;
  /** Whether PII was masked in the response. */
  piiMasked?: boolean;
  /** Whether this response was replayed from an idempotency key. */
  idempotentReplayed?: boolean;
  /** Rate-limit headroom. */
  rateLimits?: RouteplaneRateLimits;
}

export interface Model {
  id: string;
  object: 'model';
  created?: number;
  owned_by?: string;
}

export interface ModelList {
  object: 'list';
  data: Model[];
}

export interface ProviderStatus {
  name: string;
  healthy: boolean;
  circuit?: 'closed' | 'open' | 'half-open';
}

export interface StatusResponse {
  status: string;
  version?: string;
  providers?: ProviderStatus[];
}

function toBool(value: string): boolean {
  return value === 'true' || value === '1';
}

function toNumber(value: string | null): number | undefined {
  if (value === null || value.trim() === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function parseRateLimits(headers: HeadersLike): RouteplaneRateLimits | undefined {
  const limits: RouteplaneRateLimits = {};
  const requestsLimit = toNumber(headers.get('x-routeplane-ratelimit-requests-limit'));
  const requestsRemaining = toNumber(headers.get('x-routeplane-ratelimit-requests-remaining'));
  const requestsReset = headers.get('x-routeplane-ratelimit-requests-reset');
  const tokensLimit = toNumber(headers.get('x-routeplane-ratelimit-tokens-limit'));
  const tokensRemaining = toNumber(headers.get('x-routeplane-ratelimit-tokens-remaining'));
  const tokensReset = headers.get('x-routeplane-ratelimit-tokens-reset');

  if (requestsLimit !== undefined) limits.requestsLimit = requestsLimit;
  if (requestsRemaining !== undefined) limits.requestsRemaining = requestsRemaining;
  if (requestsReset !== null) limits.requestsReset = requestsReset;
  if (tokensLimit !== undefined) limits.tokensLimit = tokensLimit;
  if (tokensRemaining !== undefined) limits.tokensRemaining = tokensRemaining;
  if (tokensReset !== null) limits.tokensReset = tokensReset;

  return Object.keys(limits).length > 0 ? limits : undefined;
}

/** Decode the `x-routeplane-*` metadata from a `fetch` Response's headers. */
export function parseResponseMeta(headers: HeadersLike): RouteplaneMeta {
  const meta: RouteplaneMeta = {};

  const provider = headers.get('x-routeplane-provider');
  if (provider !== null) meta.provider = provider;

  const traceId = headers.get('x-routeplane-trace-id');
  if (traceId !== null) meta.traceId = traceId;

  const requestId = headers.get('x-routeplane-request-id');
  if (requestId !== null) meta.requestId = requestId;

  const cache = headers.get('x-routeplane-cache');
  if (cache === 'hit' || cache === 'miss' || cache === 'bypass') meta.cache = cache;

  const guardrails = headers.get('x-routeplane-guardrails');
  if (guardrails !== null) meta.guardrails = guardrails;

  const hedged = headers.get('x-routeplane-hedged');
  if (hedged !== null) meta.hedged = toBool(hedged);

  const shed = headers.get('x-routeplane-shed');
  if (shed !== null) meta.shed = toBool(shed);

  const budgetRemaining = headers.get('x-routeplane-budget-remaining');
  if (budgetRemaining !== null) meta.budgetRemaining = budgetRemaining;

  const budgetWarning = headers.get('x-routeplane-budget-warning');
  if (budgetWarning !== null) meta.budgetWarning = budgetWarning;

  const complianceWarning = headers.get('x-routeplane-compliance-warning');
  if (complianceWarning !== null) meta.complianceWarning = complianceWarning;

  const piiMasked = headers.get('x-routeplane-pii-masked');
  if (piiMasked !== null) meta.piiMasked = toBool(piiMasked);

  const idempotentReplayed = headers.get('x-routeplane-idempotent-replayed');
  if (idempotentReplayed !== null) meta.idempotentReplayed = toBool(idempotentReplayed);

  const rateLimits = parseRateLimits(headers);
  if (rateLimits !== undefined) meta.rateLimits = rateLimits;

  return meta;
}
