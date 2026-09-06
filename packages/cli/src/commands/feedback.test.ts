import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseFeedbackScore, runFeedback } from './feedback.js';

const connection = { apiKey: 'rp_test', baseUrl: 'https://gateway.example.test' };
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('feedback command wire', () => {
  it.each(['-10', '0', '10', '1.0', '-0'])('accepts integral score argument %s', (value) => {
    expect(parseFeedbackScore(value)).toBe(Number(value));
  });
  it.each(['', ' ', 'true', 'null', 'NaN', 'Infinity', '-Infinity', '0.5', '-11', '11'])('rejects invalid score argument %s', (value) => {
    expect(() => parseFeedbackScore(value)).toThrow(/--score/);
  });
  it('uses the legacy wire and describes acknowledgement only', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const output = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    await expect(runFeedback(connection, { requestId: 'req_gateway', score: 1, comment: '' })).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetch.mock.calls[0]![1].body)).toEqual({ trace_id: 'req_gateway', value: 1 });
    expect(output.mock.calls.flat().join('')).toMatch(/acknowledged/i);
    expect(output.mock.calls.flat().join('')).not.toMatch(/recorded|stored|durable/i);
  });

  it.each([-11, 11, 0.5, NaN, Infinity])('rejects score %s without dispatch or acknowledgement', async (score) => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const output = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    await expect(runFeedback(connection, { requestId: 'req_gateway', score })).rejects.toThrow(/score/);
    expect(fetch).not.toHaveBeenCalled();
    expect(output).not.toHaveBeenCalled();
  });

  it.each(['note', ' ', '\t'])('rejects unsupported comment %s without dispatch', async (comment) => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(runFeedback(connection, { requestId: 'req_gateway', score: 1, comment })).rejects.toThrow(/comment/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('propagates gateway refusal without printing acknowledgement', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{"error":"denied"}', { status: 401 }));
    vi.stubGlobal('fetch', fetch);
    const output = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    await expect(runFeedback(connection, { requestId: 'req_gateway', score: 1 })).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(output).not.toHaveBeenCalled();
  });
});
