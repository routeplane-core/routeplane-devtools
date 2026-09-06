import { afterEach, describe, expect, it, vi } from 'vitest';
import { RouteplaneCoreClient, RouteplaneError } from '../client.js';
import type { FeedbackOptions } from './feedback.js';

const client = () => new RouteplaneCoreClient({ apiKey: 'rp_test', baseUrl: 'https://gateway.example.test' });
afterEach(() => vi.unstubAllGlobals());

describe('legacy feedback contract', () => {
  for (const score of [-10, -1, -0, 0, 1, 10]) {
    for (const comment of [undefined, null, '']) {
      it(`sends integer value ${score} with comment ${String(comment)}`, async () => {
        const fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
        vi.stubGlobal('fetch', fetch);
        const result = await client().feedback.create({ requestId: 'req_gateway', score, comment } as FeedbackOptions);
        expect(result).toBeUndefined();
        expect(fetch).toHaveBeenCalledTimes(1);
        const [url, init] = fetch.mock.calls[0]!;
        expect(url).toBe('https://gateway.example.test/v1/feedback');
        expect(init.method).toBe('POST');
        expect(init.headers['x-routeplane-api-key']).toBe('rp_test');
        expect(JSON.parse(init.body)).toEqual({ trace_id: 'req_gateway', value: score === 0 ? 0 : score });
      });
    }
  }

  it.each([-11, 11, 0.5, -0.5, NaN, Infinity, -Infinity, true, false, null, undefined, '1', {}, []])(
    'rejects invalid score %s before dispatch', async (score) => {
      const fetch = vi.fn();
      vi.stubGlobal('fetch', fetch);
      await expect(client().feedback.create({ requestId: 'req_gateway', score } as FeedbackOptions)).rejects.toThrow(/score/);
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it.each(['note', ' ', '\t', '\n', '\u200b', false, 1, [], {}])(
    'rejects unsupported comment %s before dispatch', async (comment) => {
      const fetch = vi.fn();
      vi.stubGlobal('fetch', fetch);
      await expect(client().feedback.create({ requestId: 'req_gateway', score: 1, comment } as FeedbackOptions)).rejects.toThrow(/comment/);
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it('preserves HTTP errors without claiming acknowledgement', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"error":"denied"}', { status: 401 })));
    await expect(client().feedback.create({ requestId: 'req_gateway', score: 1 })).rejects.toBeInstanceOf(RouteplaneError);
  });

  it('preserves void return on empty 204 acknowledgement', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    await expect(client().feedback.create({ requestId: 'req_gateway', score: 1 })).resolves.toBeUndefined();
  });
});
