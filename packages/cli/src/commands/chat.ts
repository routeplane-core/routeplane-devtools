/**
 * `rp chat "message"` (or piped stdin) — streams a chat completion to the
 * terminal over SSE, then prints a one-line footer with the provider/model/tokens.
 *
 * Content is written to stdout so it pipes cleanly; the footer goes to stderr.
 */

import {
  createHeaders,
  parseResponseMeta,
  parseSSEStream,
  RouteplaneError,
  type RoutingStrategy,
} from '@routeplane/sdk/core';
import type { Connection } from '../resolve.js';
import { dim } from '../output.js';

export interface ChatOptions {
  message?: string;
  model: string;
  provider?: string;
  strategy?: string;
  residency?: string;
  system?: string;
  json: boolean;
}

interface DeltaChoice {
  delta?: { content?: string };
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8').trim();
}

async function throwHttpError(response: Response): Promise<never> {
  const meta = parseResponseMeta(response.headers);
  const text = await response.text();
  let body: unknown = text;
  let message = `chat request failed with status ${response.status}`;
  try {
    body = JSON.parse(text);
    const err = (body as { error?: unknown }).error;
    if (typeof err === 'string') message = err;
    else if (err && typeof err === 'object' && typeof (err as { message?: unknown }).message === 'string') {
      message = (err as { message: string }).message;
    }
  } catch {
    if (text) message = text;
  }
  throw new RouteplaneError(message, response.status, body, meta);
}

export async function runChat(conn: Connection, opts: ChatOptions): Promise<void> {
  let content = opts.message;
  if (content === undefined || content === '') {
    if (process.stdin.isTTY) {
      throw new Error('no message provided — pass a message argument or pipe text via stdin');
    }
    content = await readStdin();
  }
  if (!content) {
    throw new Error('no message provided');
  }

  const messages: { role: string; content: string }[] = [];
  if (opts.system) messages.push({ role: 'system', content: opts.system });
  messages.push({ role: 'user', content });

  const body = {
    model: opts.model,
    messages,
    stream: true,
    stream_options: { include_usage: true },
  };

  const headers: Record<string, string> = {
    'x-routeplane-api-key': conn.apiKey,
    'content-type': 'application/json',
    accept: 'text/event-stream',
    ...createHeaders({
      provider: opts.provider,
      strategy: opts.strategy as RoutingStrategy | undefined,
      residency: opts.residency,
    }),
  };

  const url = `${conn.baseUrl.replace(/\/+$/, '')}/v1/chat/completions`;
  const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!response.ok) await throwHttpError(response);

  const meta = parseResponseMeta(response.headers);
  let model: string | undefined;
  let totalTokens: number | undefined;

  for await (const chunk of parseSSEStream(response)) {
    if (opts.json) {
      process.stdout.write(`${JSON.stringify(chunk)}\n`);
    }
    if (typeof chunk.model === 'string') model = chunk.model;
    const usage = chunk.usage as { total_tokens?: number } | null | undefined;
    if (usage && typeof usage.total_tokens === 'number') totalTokens = usage.total_tokens;

    if (!opts.json) {
      const choices = chunk.choices as DeltaChoice[] | undefined;
      const piece = choices?.[0]?.delta?.content;
      if (typeof piece === 'string') process.stdout.write(piece);
    }
  }

  if (!opts.json) {
    process.stdout.write('\n');
    const provider = meta.provider ?? opts.provider ?? 'unknown';
    const parts = [`provider: ${provider}`, `model: ${model ?? opts.model}`];
    if (totalTokens !== undefined) parts.push(`tokens: ${totalTokens}`);
    process.stderr.write(`${dim(`[${parts.join(' | ')}]`)}\n`);
  }
}
