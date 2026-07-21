/**
 * `rp embed "text"` — generate an embedding via `POST /v1/embeddings`.
 *
 * Reads the text argument or stdin. Default output is a compact preview
 * (model, dimensions, first few values); `--json` prints the full response.
 */

import { RouteplaneCoreClient, type RouteplaneHeaders } from '@routeplane/sdk/core';
import type { Connection, OutputFormat } from '../resolve.js';
import { dim, printJson, printKeyValues } from '../output.js';

export interface EmbedOptions {
  text?: string;
  model: string;
  provider?: string;
}

interface EmbeddingItem {
  embedding?: number[];
  index?: number;
}

interface EmbeddingsResponse {
  data?: EmbeddingItem[];
  model?: string;
  usage?: { total_tokens?: number };
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8').trim();
}

const PREVIEW = 5;

export async function runEmbed(conn: Connection, output: OutputFormat, opts: EmbedOptions): Promise<void> {
  let input = opts.text;
  if (input === undefined || input === '') {
    if (process.stdin.isTTY) {
      throw new Error('no text provided — pass a text argument or pipe text via stdin');
    }
    input = await readStdin();
  }
  if (!input) {
    throw new Error('no text provided');
  }

  const headers: RouteplaneHeaders | undefined =
    opts.provider !== undefined ? { provider: opts.provider } : undefined;
  const client = new RouteplaneCoreClient({ apiKey: conn.apiKey, baseUrl: conn.baseUrl, headers });
  const response = await client.post<EmbeddingsResponse>('/v1/embeddings', {
    model: opts.model,
    input,
  });

  if (output === 'json') {
    printJson(response);
    return;
  }

  const vector = response.data?.[0]?.embedding ?? [];
  const pairs: [string, string][] = [
    ['Model', response.model ?? opts.model],
    ['Dimensions', String(vector.length)],
  ];
  if (response.usage?.total_tokens !== undefined) {
    pairs.push(['Tokens', String(response.usage.total_tokens)]);
  }
  printKeyValues(pairs);

  if (vector.length > 0) {
    const head = vector.slice(0, PREVIEW).map((n) => n.toFixed(6));
    const ellipsis = vector.length > PREVIEW ? dim(', …') : '';
    process.stdout.write(`[${head.join(', ')}${ellipsis}]\n`);
  }
}
