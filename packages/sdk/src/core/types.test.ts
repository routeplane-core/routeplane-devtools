import { describe, expect, it } from 'vitest';
import { parseResponseMeta } from './types.js';

describe('parseResponseMeta', () => {
  it('decodes the x-routeplane-* response headers', () => {
    const headers = new Headers({
      'x-routeplane-provider': 'anthropic',
      'x-routeplane-trace-id': 'trace_9',
      'x-routeplane-request-id': 'req_42',
      'x-routeplane-cache': 'hit',
      'x-routeplane-hedged': 'true',
      'x-routeplane-shed': 'false',
      'x-routeplane-pii-masked': '1',
      'x-routeplane-ratelimit-requests-remaining': '97',
      'x-routeplane-ratelimit-tokens-limit': '100000',
    });

    const meta = parseResponseMeta(headers);
    expect(meta.provider).toBe('anthropic');
    expect(meta.traceId).toBe('trace_9');
    expect(meta.requestId).toBe('req_42');
    expect(meta.cache).toBe('hit');
    expect(meta.hedged).toBe(true);
    expect(meta.shed).toBe(false);
    expect(meta.piiMasked).toBe(true);
    expect(meta.rateLimits).toEqual({ requestsRemaining: 97, tokensLimit: 100000 });
  });

  it('returns an empty object when no routeplane headers are present', () => {
    expect(parseResponseMeta(new Headers({ 'content-type': 'application/json' }))).toEqual({});
  });

  it('ignores an unrecognized cache value', () => {
    const meta = parseResponseMeta(new Headers({ 'x-routeplane-cache': 'weird' }));
    expect(meta.cache).toBeUndefined();
  });
});
