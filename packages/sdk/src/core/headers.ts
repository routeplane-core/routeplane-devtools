/**
 * Typed builder for the `x-routeplane-*` request-header family.
 *
 * These headers steer the gateway per request: which provider(s) to try, the
 * residency jurisdiction, the routing strategy, FinOps attribution, caching,
 * DLP, idempotency, and correlation. `createHeaders` is the single place that
 * knows the wire names — every client in this package builds its headers here.
 */

export type RoutingStrategy = 'priority' | 'weighted' | 'cost' | 'latency';
export type LogLevel = 'metadata' | 'none' | 'full';

export interface RouteplaneHeaders {
  /** `x-routeplane-provider` — provider or comma-separated fallback chain (e.g. `"openai,anthropic"`). */
  provider?: string;
  /** `x-routeplane-residency` — requested data-residency region code (e.g. `"IN"`). */
  residency?: string;
  /** `x-routeplane-strategy` — candidate ordering strategy. */
  strategy?: RoutingStrategy;
  /** `x-routeplane-config` — inline routing config; JSON-serialized. */
  config?: Record<string, unknown>;
  /** `x-routeplane-timeout-ms` — per-request upstream timeout budget. */
  timeoutMs?: number;
  /** `x-routeplane-use-case` — FinOps cost-attribution label. */
  useCase?: string;
  /** `x-routeplane-log-level` — how much of this request to log. */
  logLevel?: LogLevel;
  /** `x-routeplane-conversation-id` — groups requests into one conversation. */
  conversationId?: string;
  /** `x-routeplane-currency` — ISO 4217 currency for cost reporting. */
  currency?: string;
  /** `x-routeplane-metadata` — arbitrary string key/value pairs; JSON-serialized. */
  metadata?: Record<string, string>;
  /** `x-routeplane-pii-mode` — reversible PII tokenization. */
  piiMode?: 'tokenize';
  /** `x-routeplane-output-mask` — output-masking policy name. */
  outputMask?: string;
  /** `x-routeplane-cache-control` — opt a single request out of the response cache. */
  cacheControl?: 'no-store';
  /** `x-routeplane-idempotency-key` — dedupe/replay key. */
  idempotencyKey?: string;
  /** `x-routeplane-cohort` — A/B prompt-variant cohort. */
  cohort?: string;
  /** `x-routeplane-batch` — batch-eligibility hint. */
  batch?: string;
  /** `x-routeplane-trace-id` — client-supplied correlation id. */
  traceId?: string;
}

const PREFIX = 'x-routeplane-';

function validateMetadata(metadata: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (typeof key !== 'string' || key.length === 0) {
      throw new TypeError(
        `Routeplane metadata keys must be non-empty strings (got ${JSON.stringify(key)})`,
      );
    }
    if (typeof value !== 'string') {
      throw new TypeError(
        `Routeplane metadata value for "${key}" must be a string (got ${typeof value})`,
      );
    }
    out[key] = value;
  }
  return out;
}

/**
 * Build the `x-routeplane-*` header map from a typed options object.
 *
 * Undefined fields are omitted, numbers are stringified, and object fields
 * (`config`, `metadata`) are JSON-serialized. `JSON.stringify` escapes control
 * characters, so the emitted values are always safe HTTP header values. Only
 * the known keys above are read — TypeScript rejects unknown keys at the call
 * site, and any extra runtime keys are ignored.
 */
export function createHeaders(opts: RouteplaneHeaders = {}): Record<string, string> {
  const headers: Record<string, string> = {};
  const set = (name: string, value: string): void => {
    headers[`${PREFIX}${name}`] = value;
  };

  if (opts.provider !== undefined) set('provider', opts.provider);
  if (opts.residency !== undefined) set('residency', opts.residency);
  if (opts.strategy !== undefined) set('strategy', opts.strategy);
  if (opts.config !== undefined) set('config', JSON.stringify(opts.config));
  if (opts.timeoutMs !== undefined) set('timeout-ms', String(opts.timeoutMs));
  if (opts.useCase !== undefined) set('use-case', opts.useCase);
  if (opts.logLevel !== undefined) set('log-level', opts.logLevel);
  if (opts.conversationId !== undefined) set('conversation-id', opts.conversationId);
  if (opts.currency !== undefined) set('currency', opts.currency);
  if (opts.metadata !== undefined) set('metadata', JSON.stringify(validateMetadata(opts.metadata)));
  if (opts.piiMode !== undefined) set('pii-mode', opts.piiMode);
  if (opts.outputMask !== undefined) set('output-mask', opts.outputMask);
  if (opts.cacheControl !== undefined) set('cache-control', opts.cacheControl);
  if (opts.idempotencyKey !== undefined) set('idempotency-key', opts.idempotencyKey);
  if (opts.cohort !== undefined) set('cohort', opts.cohort);
  if (opts.batch !== undefined) set('batch', opts.batch);
  if (opts.traceId !== undefined) set('trace-id', opts.traceId);

  return headers;
}

/** Later fields win. Used to layer per-request headers over client defaults. */
export function mergeHeaders(
  base: RouteplaneHeaders,
  override: RouteplaneHeaders,
): RouteplaneHeaders {
  return { ...base, ...override };
}
