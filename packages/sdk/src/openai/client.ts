/**
 * Drop-in OpenAI client pointed at the Routeplane gateway.
 *
 * `Routeplane extends OpenAI`, so every method of the official `openai` SDK
 * works unchanged — `client.chat.completions.create(...)`,
 * `client.embeddings.create(...)`, streaming, tool calls, everything. On top of
 * that it wires the gateway base URL + auth, folds client-level
 * `x-routeplane-*` headers into `defaultHeaders`, and adds
 * `withRouteplaneHeaders()` / `createChatCompletion()` for per-request steering
 * and decoded response metadata.
 *
 * `openai` is an optional peer dependency; import this entry only when it is
 * installed. The `@routeplane/sdk/core` entry has no such requirement.
 */

import OpenAI, { type ClientOptions } from 'openai';
import type { Stream } from 'openai/streaming';
import { createHeaders, type RouteplaneHeaders } from '../core/headers.js';
import { parseResponseMeta, type RouteplaneMeta } from '../core/types.js';
import { RouteplaneCoreClient } from '../core/client.js';
import type {
  AnalyticsResource,
  CacheResource,
  FeedbackResource,
  FinOpsResource,
  LogResource,
  PromptResource,
  ProvidersResource,
  ResidencyResource,
  StatusResource,
} from '../core/resources/index.js';

const DEFAULT_BASE_URL = 'https://api.routeplane.ai/v1';

type OpenAIExtraOptions = Omit<ClientOptions, 'apiKey' | 'baseURL' | 'defaultHeaders'>;

export interface RouteplaneClientOptions extends RouteplaneHeaders {
  /** The `rp_...` virtual key. */
  apiKey: string;
  /** Gateway base URL. Default: `https://api.routeplane.ai/v1`. */
  baseUrl?: string;
}

export type ChatCompletionWithMeta = OpenAI.Chat.ChatCompletion & {
  routeplane: RouteplaneMeta;
};

/** A streaming chat completion plus the gateway metadata captured from the HTTP response headers. */
export interface ChatCompletionStreamWithMeta {
  /** The OpenAI SDK chunk stream. */
  stream: Stream<OpenAI.Chat.ChatCompletionChunk>;
  /** Decoded `x-routeplane-*` response metadata, captured before the stream is iterated. */
  routeplane: RouteplaneMeta;
}

/** Strip a trailing `/v1` (with optional trailing slash) so core resources hit the URL root. */
function toCoreBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/v1\/?$/, '');
}

export class Routeplane extends OpenAI {
  /** Client-level `x-routeplane-*` header defaults, merged into every request. */
  readonly routeplaneDefaults: RouteplaneHeaders;

  /** Internal core client backing the non-OpenAI resource namespaces. */
  private readonly core: RouteplaneCoreClient;

  /** Prompt-management resource (`/v1/prompts/*`). */
  readonly prompts: PromptResource;
  /** Request-log resource (`GET /v1/logs`). */
  readonly logs: LogResource;
  /** FinOps usage/cost resource (`/v1/finops/*`). */
  readonly finops: FinOpsResource;
  /** Response-cache resource (`POST /v1/cache/purge`). */
  readonly cache: CacheResource;
  /** Quality-feedback resource (`POST /v1/feedback`). */
  readonly feedback: FeedbackResource;
  /** Gateway status resource (`GET /status`). */
  readonly gatewayStatus: StatusResource;
  /** Sovereign-residency resource (`/v1/residency/*`). */
  readonly residency: ResidencyResource;
  /** Custom-provider resource (`/v1/providers`). */
  readonly providers: ProvidersResource;
  /** Analytics resource (`/analytics`). */
  readonly analytics: AnalyticsResource;

  constructor(opts: RouteplaneClientOptions & OpenAIExtraOptions) {
    const {
      apiKey,
      baseUrl,
      provider,
      residency,
      strategy,
      config,
      timeoutMs,
      useCase,
      logLevel,
      conversationId,
      currency,
      metadata,
      piiMode,
      outputMask,
      cacheControl,
      idempotencyKey,
      cohort,
      batch,
      traceId,
      ...openaiOpts
    } = opts;

    const defaults: RouteplaneHeaders = {
      provider,
      residency,
      strategy,
      config,
      timeoutMs,
      useCase,
      logLevel,
      conversationId,
      currency,
      metadata,
      piiMode,
      outputMask,
      cacheControl,
      idempotencyKey,
      cohort,
      batch,
      traceId,
    };

    super({
      ...openaiOpts,
      apiKey,
      baseURL: baseUrl ?? DEFAULT_BASE_URL,
      defaultHeaders: createHeaders(defaults),
    });

    this.routeplaneDefaults = defaults;

    // The non-OpenAI resources live at the URL root (`/v1/...`, `/status`,
    // `/analytics`), so the backing core client strips the OpenAI `/v1` suffix.
    this.core = new RouteplaneCoreClient({
      apiKey,
      baseUrl: toCoreBaseUrl(baseUrl ?? DEFAULT_BASE_URL),
      headers: defaults,
    });
    this.prompts = this.core.prompts;
    this.logs = this.core.logs;
    this.finops = this.core.finops;
    this.cache = this.core.cache;
    this.feedback = this.core.feedback;
    this.gatewayStatus = this.core.status;
    this.residency = this.core.residency;
    this.providers = this.core.providers;
    this.analytics = this.core.analytics;
  }

  /**
   * Build a header map layering per-request `x-routeplane-*` headers over the
   * client defaults. Pass it as the `headers` request option to any native
   * OpenAI SDK call to steer that one request:
   *
   * ```ts
   * client.chat.completions.create(body, {
   *   headers: client.withRouteplaneHeaders({ provider: 'anthropic', strategy: 'cost' }),
   * });
   * ```
   */
  withRouteplaneHeaders(headers?: RouteplaneHeaders): Record<string, string> {
    return createHeaders(headers ? { ...this.routeplaneDefaults, ...headers } : this.routeplaneDefaults);
  }

  /**
   * Create a (non-streaming) chat completion with optional per-request
   * `x-routeplane-*` headers, returning the completion with decoded gateway
   * metadata attached as `.routeplane`.
   */
  async createChatCompletion(
    body: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
    headers?: RouteplaneHeaders,
  ): Promise<ChatCompletionWithMeta> {
    const { data, response } = await this.chat.completions
      .create(body, { headers: this.withRouteplaneHeaders(headers) })
      .withResponse();
    return Object.assign(data, { routeplane: parseResponseMeta(response.headers) });
  }

  /**
   * Create a streaming chat completion with optional per-request
   * `x-routeplane-*` headers. The gateway metadata is captured from the HTTP
   * response headers *before* the chunk stream is iterated (once chunks flow the
   * headers are already delivered), and returned alongside the stream:
   *
   * ```ts
   * const { stream, routeplane } = await client.createChatCompletionStream({
   *   model: 'gpt-4o-mini',
   *   messages: [{ role: 'user', content: 'hi' }],
   *   stream: true,
   * });
   * console.log(routeplane.provider);
   * for await (const chunk of stream) process(chunk);
   * ```
   */
  async createChatCompletionStream(
    body: OpenAI.Chat.ChatCompletionCreateParamsStreaming,
    headers?: RouteplaneHeaders,
  ): Promise<ChatCompletionStreamWithMeta> {
    const { data, response } = await this.chat.completions
      .create(body, { headers: this.withRouteplaneHeaders(headers) })
      .withResponse();
    return { stream: data, routeplane: parseResponseMeta(response.headers) };
  }
}
