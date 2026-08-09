import { describe, expect, it, vi } from 'vitest';
import { RouteplaneCoreClient } from '../client.js';
import type { EvalCase, EvaluatorSpec } from './evaluations.js';

/** A client whose transport is stubbed, so no network call is made. */
function stubClient(response: unknown) {
  const client = new RouteplaneCoreClient({ apiKey: 'rp_test', baseUrl: 'https://example.test' });
  const get = vi.fn().mockResolvedValue(response);
  const post = vi.fn().mockResolvedValue(response);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (client as any).get = get;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (client as any).post = post;
  return { client, get, post };
}

describe('EvaluationsResource', () => {
  it('posts cases and evaluators to the score endpoint', async () => {
    const { client, post } = stubClient({ results: [], summary: { by_evaluator: [] } });
    const cases: EvalCase[] = [{ id: 'c1', output: '{"a":1}', reference: '{"a":1}' }];
    const evaluators: EvaluatorSpec[] = [
      { type: 'valid_json' },
      { type: 'levenshtein_similarity', threshold: 0.9 },
    ];

    await client.evaluations.score(cases, evaluators);

    expect(post).toHaveBeenCalledWith('/v1/evaluations/score', { cases, evaluators });
  });

  it('reads the rubric catalog', async () => {
    const { client, get } = stubClient({ rubrics: [] });
    await client.evaluations.rubrics();
    expect(get).toHaveBeenCalledWith('/v1/evaluations/rubrics');
  });

  it('maps list options onto query params, omitting the unset ones', async () => {
    const { client, get } = stubClient({});
    await client.evaluations.list({ from: '2026-08-01', rubric: 'correctness', passed: false });
    expect(get).toHaveBeenCalledWith('/v1/evaluations', {
      from: '2026-08-01',
      rubric: 'correctness',
      passed: 'false',
    });
  });

  it('sends no params when no options are given', async () => {
    const { client, get } = stubClient({});
    await client.evaluations.list();
    expect(get).toHaveBeenCalledWith('/v1/evaluations', {});
  });

  /** `passed: false` is a real filter, not an absent one — easy to lose to a truthiness check. */
  it('keeps a false `passed` filter', async () => {
    const { client, get } = stubClient({});
    await client.evaluations.list({ passed: false });
    expect(get).toHaveBeenCalledWith('/v1/evaluations', { passed: 'false' });
  });

  it('is reachable from the client surface', () => {
    const client = new RouteplaneCoreClient({ apiKey: 'rp_test' });
    expect(client.evaluations).toBeDefined();
    expect(typeof client.evaluations.score).toBe('function');
  });
});
