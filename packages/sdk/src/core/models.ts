/**
 * Response models for the non-OpenAI gateway surfaces exposed by the core
 * resource namespaces (prompts, logs, FinOps, residency, providers, analytics).
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

/** FinOps usage export (`GET /v1/finops/usage`). Shape varies by tier; kept open. */
export type UsageData = Record<string, unknown>;

/** One day of usage rollup (`GET /v1/finops/usage/daily` → `days[]`). */
export type DailyUsage = Record<string, unknown>;

/** Usage timeseries for charting (`GET /v1/finops/timeseries`). */
export type TimeseriesData = Record<string, unknown>;

/** Response-cache savings rollup (`GET /v1/finops/cache-savings`). */
export type CacheSavings = Record<string, unknown>;

/** Per-saver cost telemetry (`GET /v1/finops/saver-metrics`). */
export type SaverMetrics = Record<string, unknown>;

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
