import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RouteplaneCoreClient, RouteplaneError } from '../client.js';

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

/** As `stubFetch`, but with an explicit status — the gateway answers policy denies with 4xx. */
function stubFetchStatus(status: number, body: unknown): void {
  const fn = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const rawHeaders = (init?.headers ?? {}) as Record<string, string>;
    captured.push({
      url: String(url),
      method: init?.method ?? 'GET',
      headers: rawHeaders,
      body: init?.body !== undefined && init.body !== null ? JSON.parse(init.body as string) : undefined,
    });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
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

describe('McpResource — enforcement points', () => {
  it('authorizeToolCall() → POST /v1/mcp/tool-call/authorize with snake_case body', async () => {
    stubFetch({ outcome: 'allow' });
    const verdict = await client().mcp.authorizeToolCall({
      agentId: 'agent-1',
      server: 'github',
      tool: 'create_issue',
      argumentUrls: ['https://api.github.com/repos/x/y/issues'],
      arguments: { title: 'hi' },
      serverManifest: '{"tools":[]}',
      runId: 'run-1',
    });
    expect(captured[0]?.method).toBe('POST');
    expect(captured[0]?.url).toBe('https://api.routeplane.ai/v1/mcp/tool-call/authorize');
    expect(captured[0]?.body).toEqual({
      server: 'github',
      tool: 'create_issue',
      agent_id: 'agent-1',
      argument_urls: ['https://api.github.com/repos/x/y/issues'],
      arguments: { title: 'hi' },
      server_manifest: '{"tools":[]}',
      run_id: 'run-1',
    });
    expect(verdict).toEqual({ outcome: 'allow' });
  });

  it('authorizeToolCall() omits agent_id so a bound key supplies it', async () => {
    stubFetch({ outcome: 'allow' });
    await client().mcp.authorizeToolCall({ server: 'github', tool: 'create_issue' });
    expect(captured[0]?.body).toEqual({ server: 'github', tool: 'create_issue' });
  });

  it('authorizeToolCall() returns a 422 deny as a verdict instead of throwing', async () => {
    stubFetchStatus(422, { outcome: 'deny', reason: 'agent not registered' });
    const verdict = await client().mcp.authorizeToolCall({ server: 'github', tool: 'x' });
    expect(verdict).toEqual({ outcome: 'deny', reason: 'agent not registered' });
  });

  it('authorizeToolCall() returns a 429 quota deny with its retry envelope', async () => {
    stubFetchStatus(429, {
      outcome: 'deny',
      reason: 'quota_exceeded',
      retry_after_ms: 4000,
      limit: 100,
      window_ms: 60000,
    });
    const verdict = await client().mcp.authorizeToolCall({ server: 'github', tool: 'x' });
    expect(verdict.outcome).toBe('deny');
    expect(verdict.retry_after_ms).toBe(4000);
  });

  it('authorizeToolCall() still throws when the tenant is not entitled (404)', async () => {
    stubFetchStatus(404, { error: 'not found' });
    await expect(client().mcp.authorizeToolCall({ server: 'github', tool: 'x' })).rejects.toThrow(
      RouteplaneError,
    );
  });

  it('inspectToolResult() → POST /v1/mcp/tool-result/inspect and decodes a deny', async () => {
    stubFetchStatus(422, { outcome: 'deny', reason: 'detector: secret_leak' });
    const verdict = await client().mcp.inspectToolResult('AKIA...');
    expect(captured[0]?.url).toBe('https://api.routeplane.ai/v1/mcp/tool-result/inspect');
    expect(captured[0]?.body).toEqual({ content: 'AKIA...' });
    expect(verdict.outcome).toBe('deny');
  });

  it('evaluateSampling() → POST /v1/mcp/sampling/evaluate', async () => {
    stubFetch({ outcome: 'allow' });
    await client().mcp.evaluateSampling({ agentId: 'a1', server: 'docs', prompt: 'summarize' });
    expect(captured[0]?.url).toBe('https://api.routeplane.ai/v1/mcp/sampling/evaluate');
    expect(captured[0]?.body).toEqual({ server: 'docs', prompt: 'summarize', agent_id: 'a1' });
  });
});

describe('McpResource — run governance', () => {
  it('runStep() → POST /v1/mcp/run/step with run_id and cost', async () => {
    stubFetch({ decision: 'continue', iterations: 3 });
    const out = await client().mcp.runStep({ agentId: 'a1', runId: 'run-1', costMicroUsd: 250 });
    expect(captured[0]?.url).toBe('https://api.routeplane.ai/v1/mcp/run/step');
    expect(captured[0]?.body).toEqual({ run_id: 'run-1', agent_id: 'a1', cost_micro_usd: 250 });
    expect(out.decision).toBe('continue');
  });

  it('runStep() returns a 422 stop as a decision instead of throwing', async () => {
    stubFetchStatus(422, { decision: 'stop', reason: 'agent not registered', iterations: 0 });
    const out = await client().mcp.runStep({ runId: 'run-1' });
    expect(out).toEqual({ decision: 'stop', reason: 'agent not registered', iterations: 0 });
  });

  it('listRuns() → GET /v1/mcp/runs and unwraps `runs`', async () => {
    stubFetch({ runs: [{ run_id: 'run-1', iterations: 2 }] });
    const runs = await client().mcp.listRuns();
    expect(captured[0]?.url).toBe('https://api.routeplane.ai/v1/mcp/runs');
    expect(runs).toEqual([{ run_id: 'run-1', iterations: 2 }]);
  });

  it('securityEvents() → GET /v1/mcp/security/events and unwraps `events`', async () => {
    stubFetch({ events: [{ category: 'mcp_egress_deny' }] });
    const events = await client().mcp.securityEvents();
    expect(captured[0]?.url).toBe('https://api.routeplane.ai/v1/mcp/security/events');
    expect(events).toEqual([{ category: 'mcp_egress_deny' }]);
  });
});

describe('McpResource — HITL, receipts, anomaly', () => {
  it('approveHitl()/denyHitl() → POST /v1/mcp/hitl/* with `id` and optional `note`', async () => {
    stubFetch({ id: 'h1', status: 'approved' });
    const c = client();
    await c.mcp.approveHitl('h1');
    await c.mcp.denyHitl('h2', 'looks like exfil');
    expect(captured.map((x) => x.url)).toEqual([
      'https://api.routeplane.ai/v1/mcp/hitl/approve',
      'https://api.routeplane.ai/v1/mcp/hitl/deny',
    ]);
    expect(captured[0]?.body).toEqual({ id: 'h1' });
    expect(captured[1]?.body).toEqual({ id: 'h2', note: 'looks like exfil' });
  });

  it('hitlStatus() → GET /v1/mcp/hitl/status/{id} (URL-encoded)', async () => {
    stubFetch({ id: 'h/1', status: 'pending' });
    await client().mcp.hitlStatus('h/1');
    expect(captured[0]?.url).toBe('https://api.routeplane.ai/v1/mcp/hitl/status/h%2F1');
  });

  it('listPendingHitl() → GET /v1/mcp/hitl/pending (a bare array)', async () => {
    stubFetch([{ id: 'h1', tool: 'delete_repo' }]);
    const pending = await client().mcp.listPendingHitl();
    expect(captured[0]?.url).toBe('https://api.routeplane.ai/v1/mcp/hitl/pending');
    expect(pending).toEqual([{ id: 'h1', tool: 'delete_repo' }]);
  });

  it('issueReceipt() → POST /v1/mcp/receipt/issue with the lowercase decision', async () => {
    stubFetch({ body: { seq: 1 }, entry_hash: 'abc' });
    await client().mcp.issueReceipt({
      agentId: 'a1',
      runId: 'run-1',
      server: 'github',
      tool: 'create_issue',
      arguments: { title: 'hi' },
      decision: 'allowed',
      result: '{"ok":true}',
    });
    expect(captured[0]?.url).toBe('https://api.routeplane.ai/v1/mcp/receipt/issue');
    expect(captured[0]?.body).toEqual({
      run_id: 'run-1',
      server: 'github',
      tool: 'create_issue',
      decision: 'allowed',
      agent_id: 'a1',
      arguments: { title: 'hi' },
      result: '{"ok":true}',
    });
  });

  it('verifyReceipt() → POST /v1/mcp/receipt/verify with the receipt as the body', async () => {
    stubFetch({ valid: true, mode: 'chain_only' });
    const receipt = {
      body: {
        schema_version: 1,
        seq: 1,
        agent_id: 'a1',
        run_id: 'run-1',
        server: 'github',
        tool: 'create_issue',
        arg_shape: 'deadbeef',
        decision: 'Allowed' as const,
        result_hash: '',
        timestamp: '2026-07-27T00:00:00Z',
      },
      prev_hash: 'GENESIS',
      entry_hash: 'abc',
      algorithm: 'PS256',
      key_ref: 'https://kv/keys/k/1',
      signature: 'sig',
    };
    const out = await client().mcp.verifyReceipt(receipt);
    expect(captured[0]?.body).toEqual(receipt);
    expect(out).toEqual({ valid: true, mode: 'chain_only' });
  });

  it('anomalyStatus()/clearAnomaly() → the anomaly operator surface', async () => {
    stubFetch({ agent_id: 'a 1', quarantined: true });
    const c = client();
    await c.mcp.anomalyStatus('a 1');
    await c.mcp.clearAnomaly('a 1');
    expect(captured.map((x) => x.url)).toEqual([
      'https://api.routeplane.ai/v1/mcp/anomaly/status/a%201',
      'https://api.routeplane.ai/v1/mcp/anomaly/clear',
    ]);
    expect(captured[1]?.body).toEqual({ agent_id: 'a 1' });
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
