import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RouteplaneCoreClient } from '../client.js';

interface Captured {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

const originalFetch = globalThis.fetch;
let captured: Captured[];

/** Replace global fetch with a stub that records the request and returns `body` as JSON. */
function stubFetch(body: unknown, headers?: Record<string, string>): void {
  const fn = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const rawHeaders = (init?.headers ?? {}) as Record<string, string>;
    captured.push({
      url: String(url),
      method: init?.method ?? 'GET',
      headers: rawHeaders,
      body: init?.body !== undefined && init.body !== null ? JSON.parse(init.body as string) : undefined,
    });
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json', ...(headers ?? {}) },
    });
  });
  globalThis.fetch = fn as unknown as typeof fetch;
}

function client(): RouteplaneCoreClient {
  return new RouteplaneCoreClient({ apiKey: 'rp_test' });
}

beforeEach(() => {
  captured = [];
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('PromptResource', () => {
  it('get() → GET /v1/prompts/{reference} (URL-encoded)', async () => {
    stubFetch({ reference: 'greet/v2' });
    await client().prompts.get('greet/v2');
    expect(captured[0]?.method).toBe('GET');
    expect(captured[0]?.url).toBe('https://api.routeplane.ai/v1/prompts/greet%2Fv2');
  });

  it('render() → POST /v1/prompts/{reference}/render with variables', async () => {
    stubFetch({ text: 'hi bob' });
    await client().prompts.render('greet', { name: 'bob' });
    expect(captured[0]?.method).toBe('POST');
    expect(captured[0]?.url).toBe('https://api.routeplane.ai/v1/prompts/greet/render');
    expect(captured[0]?.body).toEqual({ variables: { name: 'bob' } });
  });

  it('complete() → POST /v1/prompts/{reference}/completions, model in body, provider as header', async () => {
    stubFetch({ id: 'cmpl_1' });
    const out = await client().prompts.complete('greet', {
      variables: { name: 'bob' },
      model: 'gpt-4o-mini',
      provider: 'anthropic',
    });
    expect(captured[0]?.method).toBe('POST');
    expect(captured[0]?.url).toBe('https://api.routeplane.ai/v1/prompts/greet/completions');
    expect(captured[0]?.body).toEqual({ variables: { name: 'bob' }, model: 'gpt-4o-mini' });
    expect(captured[0]?.headers['x-routeplane-provider']).toBe('anthropic');
    expect(out).toEqual({ id: 'cmpl_1' });
  });
});

describe('LogResource', () => {
  it('list() → GET /v1/logs?limit and unwraps `events`', async () => {
    stubFetch({ events: [{ request_id: 'r1' }, { request_id: 'r2' }] });
    const logs = await client().logs.list({ limit: 5 });
    expect(captured[0]?.method).toBe('GET');
    expect(captured[0]?.url).toBe('https://api.routeplane.ai/v1/logs?limit=5');
    expect(logs).toEqual([{ request_id: 'r1' }, { request_id: 'r2' }]);
  });

  it('list() with no options omits the limit param', async () => {
    stubFetch({ events: [] });
    await client().logs.list();
    expect(captured[0]?.url).toBe('https://api.routeplane.ai/v1/logs');
  });
});

describe('FinOpsResource', () => {
  it('usage() → GET /v1/finops/usage', async () => {
    stubFetch({ spend: 1 });
    await client().finops.usage();
    expect(captured[0]?.url).toBe('https://api.routeplane.ai/v1/finops/usage');
  });

  it('usageDaily() → GET /v1/finops/usage/daily?from&to and unwraps `days`', async () => {
    stubFetch({ days: [{ date: '2026-07-01' }] });
    const days = await client().finops.usageDaily({ from: '2026-07-01', to: '2026-07-02' });
    expect(captured[0]?.url).toBe(
      'https://api.routeplane.ai/v1/finops/usage/daily?from=2026-07-01&to=2026-07-02',
    );
    expect(days).toEqual([{ date: '2026-07-01' }]);
  });

  it('timeseries/cacheSavings/saverMetrics hit their paths', async () => {
    stubFetch({});
    const c = client();
    await c.finops.timeseries();
    await c.finops.cacheSavings();
    await c.finops.saverMetrics();
    expect(captured.map((x) => x.url)).toEqual([
      'https://api.routeplane.ai/v1/finops/timeseries',
      'https://api.routeplane.ai/v1/finops/cache-savings',
      'https://api.routeplane.ai/v1/finops/saver-metrics',
    ]);
  });
});

describe('CacheResource / FeedbackResource', () => {
  it('cache.purge() → POST /v1/cache/purge', async () => {
    stubFetch({});
    await client().cache.purge();
    expect(captured[0]?.method).toBe('POST');
    expect(captured[0]?.url).toBe('https://api.routeplane.ai/v1/cache/purge');
  });

  it('feedback.create() → POST /v1/feedback with snake_case body', async () => {
    stubFetch({});
    await client().feedback.create({ requestId: 'req_9', score: 1, comment: 'good' });
    expect(captured[0]?.method).toBe('POST');
    expect(captured[0]?.url).toBe('https://api.routeplane.ai/v1/feedback');
    expect(captured[0]?.body).toEqual({ request_id: 'req_9', score: 1, comment: 'good' });
  });
});

describe('StatusResource / ResidencyResource', () => {
  it('status.get() → GET /status (root, not /v1)', async () => {
    stubFetch({ status: 'ok' });
    await client().status.get();
    expect(captured[0]?.url).toBe('https://api.routeplane.ai/status');
  });

  it('residency.summary()/ledger() → GET /v1/residency/*', async () => {
    stubFetch({ entries: [] });
    const c = client();
    await c.residency.summary();
    await c.residency.ledger();
    expect(captured.map((x) => x.url)).toEqual([
      'https://api.routeplane.ai/v1/residency/summary',
      'https://api.routeplane.ai/v1/residency/ledger',
    ]);
  });
});

describe('ModelsResource', () => {
  it('list() → GET /v1/models?provider and unwraps `data`', async () => {
    stubFetch({ object: 'list', data: [{ id: 'gpt-4o', object: 'model' }] });
    const models = await client().models.list({ provider: 'openai' });
    expect(captured[0]?.url).toBe('https://api.routeplane.ai/v1/models?provider=openai');
    expect(models).toEqual([{ id: 'gpt-4o', object: 'model' }]);
  });

  it('get() → GET /v1/models/{id} (URL-encoded)', async () => {
    stubFetch({ id: 'meta/llama', object: 'model' });
    await client().models.get('meta/llama');
    expect(captured[0]?.url).toBe('https://api.routeplane.ai/v1/models/meta%2Fllama');
  });
});

describe('ProvidersResource', () => {
  it('list() → GET /v1/providers and unwraps `data`', async () => {
    stubFetch({ object: 'list', data: [{ name: 'local' }] });
    const providers = await client().providers.list();
    expect(captured[0]?.url).toBe('https://api.routeplane.ai/v1/providers');
    expect(providers).toEqual([{ name: 'local' }]);
  });

  it('create() → POST /v1/providers with base_url and optional api_key', async () => {
    stubFetch({ name: 'local' });
    await client().providers.create({ name: 'local', base_url: 'http://localhost:11434/v1' });
    expect(captured[0]?.method).toBe('POST');
    expect(captured[0]?.body).toEqual({ name: 'local', base_url: 'http://localhost:11434/v1' });
  });

  it('delete() → DELETE /v1/providers/{name} (URL-encoded)', async () => {
    stubFetch({});
    await client().providers.delete('local one');
    expect(captured[0]?.method).toBe('DELETE');
    expect(captured[0]?.url).toBe('https://api.routeplane.ai/v1/providers/local%20one');
  });
});

describe('AnalyticsResource', () => {
  it('events() → GET /analytics (root)', async () => {
    stubFetch([{ id: 'e1' }]);
    const events = await client().analytics.events();
    expect(captured[0]?.url).toBe('https://api.routeplane.ai/analytics');
    expect(events).toEqual([{ id: 'e1' }]);
  });

  it('latency() → GET /analytics/latency', async () => {
    stubFetch({});
    await client().analytics.latency();
    expect(captured[0]?.url).toBe('https://api.routeplane.ai/analytics/latency');
  });
});

describe('metadata convenience', () => {
  it('getWithMeta() returns data, decoded meta, and raw headers', async () => {
    stubFetch({ ok: true }, { 'x-routeplane-provider': 'anthropic', 'x-routeplane-cache': 'hit' });
    const { data, meta, headers } = await client().getWithMeta<{ ok: boolean }>('/v1/finops/usage');
    expect(data).toEqual({ ok: true });
    expect(meta.provider).toBe('anthropic');
    expect(meta.cache).toBe('hit');
    expect(headers.get('x-routeplane-provider')).toBe('anthropic');
  });

  it('postWithMeta() forwards extra headers and returns meta', async () => {
    stubFetch({ id: 'x' }, { 'x-routeplane-request-id': 'req_1' });
    const { data, meta } = await client().postWithMeta<{ id: string }>(
      '/v1/cache/purge',
      { a: 1 },
      { 'x-routeplane-provider': 'groq' },
    );
    expect(data).toEqual({ id: 'x' });
    expect(meta.requestId).toBe('req_1');
    expect(captured[0]?.headers['x-routeplane-provider']).toBe('groq');
    expect(captured[0]?.body).toEqual({ a: 1 });
  });
});
