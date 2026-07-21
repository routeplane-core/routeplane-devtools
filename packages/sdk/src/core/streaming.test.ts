import { describe, expect, it } from 'vitest';
import { parseSSEStream } from './streaming.js';

async function collect(body: string): Promise<Record<string, unknown>[]> {
  const chunks: Record<string, unknown>[] = [];
  for await (const chunk of parseSSEStream(new Response(body))) {
    chunks.push(chunk);
  }
  return chunks;
}

describe('parseSSEStream', () => {
  it('parses data frames and stops at [DONE]', async () => {
    const body =
      'data: {"id":"1","choices":[{"delta":{"content":"Hel"}}]}\n\n' +
      'data: {"id":"1","choices":[{"delta":{"content":"lo"}}]}\n\n' +
      'data: [DONE]\n\n';
    const chunks = await collect(body);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.id).toBe('1');
  });

  it('ignores comment lines and blank keep-alives', async () => {
    const body = ': keep-alive\n\ndata: {"n":1}\n\n: ping\n\ndata: [DONE]\n\n';
    const chunks = await collect(body);
    expect(chunks).toEqual([{ n: 1 }]);
  });

  it('tolerates CRLF line endings', async () => {
    const body = 'data: {"n":1}\r\n\r\ndata: {"n":2}\r\n\r\ndata: [DONE]\r\n\r\n';
    const chunks = await collect(body);
    expect(chunks).toEqual([{ n: 1 }, { n: 2 }]);
  });

  it('flushes a final frame that is not blank-line terminated', async () => {
    const chunks = await collect('data: {"n":1}');
    expect(chunks).toEqual([{ n: 1 }]);
  });

  it('throws when the response has no body', async () => {
    const bodiless = new Response(null);
    expect(bodiless.body).toBeNull();
    await expect(async () => {
      for await (const chunk of parseSSEStream(bodiless)) {
        void chunk;
      }
    }).rejects.toThrow(/no body/);
  });
});
