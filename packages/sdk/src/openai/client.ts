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
import { createHeaders, type RouteplaneHeaders } from '../core/headers.js';
import { parseResponseMeta, type RouteplaneMeta } from '../core/types.js';

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

export class Routeplane extends OpenAI {
  /** Client-level `x-routeplane-*` header defaults, merged into every request. */
  readonly routeplaneDefaults: RouteplaneHeaders;

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
}
