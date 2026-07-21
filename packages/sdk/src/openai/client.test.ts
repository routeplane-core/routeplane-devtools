import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Routeplane } from './client.js';

const originalFetch = globalThis.fetch;
let urls: string[];

function stubFetch(body: unknown): void {
  const fn = vi.fn(async (url: string | URL) => {
    urls.push(String(url));
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  globalThis.fetch = fn as unknown as typeof fetch;
}

beforeEach(() => {
  urls = [];
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('Routeplane (OpenAI extension) resource wiring', () => {
  it('exposes the non-OpenAI resources, backed by a root-based core client', async () => {
    stubFetch({ spend: 0 });
    const client = new Routeplane({ apiKey: 'rp_test' });
    await client.finops.usage();
    // Default OpenAI baseUrl is `.../v1`; resources must hit the URL root.
    expect(urls[0]).toBe('https://api.routeplane.ai/v1/finops/usage');
  });

  it('strips a trailing /v1 from a custom baseUrl for root-served surfaces', async () => {
    stubFetch([]);
    const client = new Routeplane({ apiKey: 'rp_test', baseUrl: 'http://localhost:8080/v1' });
    await client.analytics.events();
    expect(urls[0]).toBe('http://localhost:8080/analytics');
  });

  it('does not shadow the native OpenAI `models` resource', () => {
    const client = new Routeplane({ apiKey: 'rp_test' });
    // The native OpenAI Models resource exposes `retrieve`; our core ModelsResource does not.
    expect(typeof (client.models as { retrieve?: unknown }).retrieve).toBe('function');
  });

  it('withRouteplaneHeaders still layers per-request over client defaults', () => {
    const client = new Routeplane({ apiKey: 'rp_test', provider: 'openai', strategy: 'priority' });
    const headers = client.withRouteplaneHeaders({ provider: 'anthropic' });
    expect(headers['x-routeplane-provider']).toBe('anthropic');
    expect(headers['x-routeplane-strategy']).toBe('priority');
  });
});
