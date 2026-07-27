import { describe, expect, it } from 'vitest';
import { ROUTING_STRATEGIES, createHeaders, mergeHeaders } from './headers.js';

describe('createHeaders', () => {
  it('maps known fields to their x-routeplane-* wire names', () => {
    const headers = createHeaders({
      provider: 'openai,anthropic',
      residency: 'IN',
      strategy: 'cost',
      timeoutMs: 5000,
      useCase: 'support-bot',
      logLevel: 'metadata',
      conversationId: 'conv_123',
      currency: 'INR',
      piiMode: 'tokenize',
      outputMask: 'strict',
      cacheControl: 'no-store',
      idempotencyKey: 'idem_1',
      cohort: 'B',
      batch: 'nightly',
      traceId: 'trace_9',
    });

    expect(headers['x-routeplane-provider']).toBe('openai,anthropic');
    expect(headers['x-routeplane-residency']).toBe('IN');
    expect(headers['x-routeplane-strategy']).toBe('cost');
    expect(headers['x-routeplane-timeout-ms']).toBe('5000');
    expect(headers['x-routeplane-use-case']).toBe('support-bot');
    expect(headers['x-routeplane-log-level']).toBe('metadata');
    expect(headers['x-routeplane-conversation-id']).toBe('conv_123');
    expect(headers['x-routeplane-currency']).toBe('INR');
    expect(headers['x-routeplane-pii-mode']).toBe('tokenize');
    expect(headers['x-routeplane-output-mask']).toBe('strict');
    expect(headers['x-routeplane-cache-control']).toBe('no-store');
    expect(headers['x-routeplane-idempotency-key']).toBe('idem_1');
    expect(headers['x-routeplane-cohort']).toBe('B');
    expect(headers['x-routeplane-batch']).toBe('nightly');
    expect(headers['x-routeplane-trace-id']).toBe('trace_9');
  });

  it('omits undefined fields', () => {
    const headers = createHeaders({ provider: 'openai' });
    expect(Object.keys(headers)).toEqual(['x-routeplane-provider']);
  });

  it('returns an empty map for empty input', () => {
    expect(createHeaders()).toEqual({});
  });

  it('JSON-serializes config and metadata', () => {
    const headers = createHeaders({
      config: { retries: 2, fallback: ['a', 'b'] },
      metadata: { team: 'payments', tier: 'gold' },
    });
    expect(JSON.parse(headers['x-routeplane-config'] as string)).toEqual({
      retries: 2,
      fallback: ['a', 'b'],
    });
    expect(JSON.parse(headers['x-routeplane-metadata'] as string)).toEqual({
      team: 'payments',
      tier: 'gold',
    });
  });

  it('rejects non-string metadata values', () => {
    // @ts-expect-error — deliberately violating the type to exercise runtime validation
    expect(() => createHeaders({ metadata: { count: 3 } })).toThrow(TypeError);
  });
});

describe('mergeHeaders', () => {
  it('lets later fields win', () => {
    const merged = mergeHeaders({ provider: 'openai', strategy: 'priority' }, { strategy: 'latency' });
    expect(merged).toEqual({ provider: 'openai', strategy: 'latency' });
  });
});

describe('routing strategies', () => {
  it('emits every gateway-supported strategy', () => {
    // Regression: round_robin and least_busy shipped in the gateway but were
    // absent from this union (and from the MCP tool schema), so callers could not
    // select them without casting.
    for (const s of ROUTING_STRATEGIES) {
      expect(createHeaders({ strategy: s })['x-routeplane-strategy']).toBe(s);
    }
  });

  it('covers the seven the gateway parses', () => {
    expect([...ROUTING_STRATEGIES]).toEqual([
      'priority',
      'weighted',
      'cost',
      'latency',
      'round_robin',
      'least_busy',
      'canary',
    ]);
  });
});

describe('canary share', () => {
  it('emits the share header for a canary experiment', () => {
    const h = createHeaders({ provider: 'openai,anthropic', strategy: 'canary', canaryShareBps: 500 });
    expect(h['x-routeplane-strategy']).toBe('canary');
    expect(h['x-routeplane-canary-share-bps']).toBe('500');
  });

  it('omits the header entirely when not set', () => {
    expect(createHeaders({ strategy: 'canary' })['x-routeplane-canary-share-bps']).toBeUndefined();
  });

  // 0 is the gateway's "experiment off" value and must still be SENT rather than
  // dropped as falsy — `if (x)` instead of `if (x !== undefined)` would silently
  // turn an explicit ramp-to-zero into "no header", which reads identically to
  // "never configured" and would strand callers on the candidate arm.
  it('emits an explicit zero rather than dropping it', () => {
    expect(createHeaders({ canaryShareBps: 0 })['x-routeplane-canary-share-bps']).toBe('0');
  });
});
