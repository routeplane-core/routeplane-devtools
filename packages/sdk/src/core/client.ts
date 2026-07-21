/**
 * Zero-dependency HTTP client for the non-OpenAI gateway surfaces (prompts,
 * logs, FinOps, cache, feedback, status). Uses native `fetch`; every request
 * carries `x-routeplane-api-key` plus the client's default `x-routeplane-*`
 * headers, and decodes the response metadata onto errors.
 */

import { createHeaders, type RouteplaneHeaders } from './headers.js';
import { parseResponseMeta, type RouteplaneMeta } from './types.js';
import { parseSSEStream } from './streaming.js';

export interface RouteplaneConfig {
  /** The `rp_...` virtual key. */
  apiKey: string;
  /** Gateway base URL. Default: `https://api.routeplane.ai`. */
  baseUrl?: string;
  /** Per-request timeout in milliseconds. Default: 30000. */
  timeout?: number;
  /** Default `x-routeplane-*` headers applied to every request. */
  headers?: RouteplaneHeaders;
}

const DEFAULT_BASE_URL = 'https://api.routeplane.ai';
const DEFAULT_TIMEOUT_MS = 30_000;

/** Error thrown for non-2xx responses (and client-side timeouts, with status 0). */
export class RouteplaneError extends Error {
  readonly status: number;
  readonly body: unknown;
  readonly meta: RouteplaneMeta;
  readonly requestId: string | undefined;

  constructor(message: string, status: number, body: unknown, meta: RouteplaneMeta) {
    super(message);
    this.name = 'RouteplaneError';
    this.status = status;
    this.body = body;
    this.meta = meta;
    this.requestId = meta.requestId;
  }
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

function extractErrorMessage(payload: unknown, status: number): string {
  if (payload !== null && typeof payload === 'object' && 'error' in payload) {
    const error = (payload as { error: unknown }).error;
    if (typeof error === 'string') return error;
    if (
      error !== null &&
      typeof error === 'object' &&
      'message' in error &&
      typeof (error as { message: unknown }).message === 'string'
    ) {
      return (error as { message: string }).message;
    }
  }
  return `Routeplane request failed with status ${status}`;
}

export class RouteplaneCoreClient {
  readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeout: number;
  private readonly defaultHeaders: Record<string, string>;

  constructor(config: RouteplaneConfig) {
    if (!config.apiKey) {
      throw new Error('Routeplane: `apiKey` is required');
    }
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.timeout = config.timeout ?? DEFAULT_TIMEOUT_MS;
    this.defaultHeaders = config.headers ? createHeaders(config.headers) : {};
  }

  get<T>(path: string, params?: Record<string, string>): Promise<T> {
    return this.request<T>('GET', path, { params });
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, { body });
  }

  delete<T>(path: string): Promise<T> {
    return this.request<T>('DELETE', path);
  }

  /**
   * POST a request and stream the SSE response as decoded JSON chunks. Streaming
   * requests are not bounded by the client timeout, since a stream may legitimately
   * outlive it.
   */
  async *stream(
    path: string,
    body?: unknown,
    opts?: { headers?: RouteplaneHeaders },
  ): AsyncGenerator<Record<string, unknown>> {
    const response = await fetch(this.buildUrl(path), {
      method: 'POST',
      headers: {
        ...this.buildHeaders(opts?.headers),
        accept: 'text/event-stream',
        'content-type': 'application/json',
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) {
      const meta = parseResponseMeta(response.headers);
      const payload = await this.parseBody(response);
      throw new RouteplaneError(extractErrorMessage(payload, response.status), response.status, payload, meta);
    }
    yield* parseSSEStream(response);
  }

  private buildUrl(path: string, params?: Record<string, string>): string {
    const relative = path.startsWith('/') ? path : `/${path}`;
    const url = new URL(this.baseUrl + relative);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) url.searchParams.set(key, value);
      }
    }
    return url.toString();
  }

  private buildHeaders(perRequest?: RouteplaneHeaders): Record<string, string> {
    return {
      'x-routeplane-api-key': this.apiKey,
      ...this.defaultHeaders,
      ...(perRequest ? createHeaders(perRequest) : {}),
    };
  }

  private async request<T>(
    method: string,
    path: string,
    opts: { body?: unknown; params?: Record<string, string> } = {},
  ): Promise<T> {
    const hasBody = opts.body !== undefined;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    let response: Response;
    try {
      response = await fetch(this.buildUrl(path, opts.params), {
        method,
        headers: {
          ...this.buildHeaders(),
          accept: 'application/json',
          ...(hasBody ? { 'content-type': 'application/json' } : {}),
        },
        body: hasBody ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      if (isAbortError(err)) {
        throw new RouteplaneError(
          `Routeplane request to ${path} timed out after ${this.timeout}ms`,
          0,
          undefined,
          {},
        );
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }

    const meta = parseResponseMeta(response.headers);
    const payload = await this.parseBody(response);

    if (!response.ok) {
      throw new RouteplaneError(extractErrorMessage(payload, response.status), response.status, payload, meta);
    }
    return payload as T;
  }

  private async parseBody(response: Response): Promise<unknown> {
    if (response.status === 204) return undefined;
    const text = await response.text();
    if (text.length === 0) return undefined;
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    }
    return text;
  }
}
