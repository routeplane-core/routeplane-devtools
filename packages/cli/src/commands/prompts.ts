/**
 * `rp prompts {list,get,render}` — prompt-template management.
 *
 * - `list`   → `GET /v1/prompts` (skipped gracefully if the gateway lacks it)
 * - `get`    → `GET /v1/prompts/{reference}`
 * - `render` → `POST /v1/prompts/{reference}/render` with `{ variables }`
 */

import {
  RouteplaneCoreClient,
  RouteplaneError,
  type Prompt,
  type RenderedPrompt,
} from '@routeplane/sdk/core';
import type { Connection, OutputFormat } from '../resolve.js';
import { printJson, printKeyValues, printTable } from '../output.js';

function client(conn: Connection): RouteplaneCoreClient {
  return new RouteplaneCoreClient({ apiKey: conn.apiKey, baseUrl: conn.baseUrl });
}

interface PromptList {
  data?: Prompt[];
  prompts?: Prompt[];
}

function referenceOf(p: Prompt): string {
  const ref = p.reference ?? p.id;
  return typeof ref === 'string' ? ref : '';
}

export async function runPromptsList(conn: Connection, output: OutputFormat): Promise<void> {
  let body: PromptList | Prompt[];
  try {
    body = await client(conn).get<PromptList | Prompt[]>('/v1/prompts');
  } catch (err) {
    if (err instanceof RouteplaneError && (err.status === 404 || err.status === 405)) {
      process.stdout.write('This gateway does not expose a prompt-list endpoint (GET /v1/prompts).\n');
      return;
    }
    throw err;
  }

  const prompts = Array.isArray(body) ? body : (body.data ?? body.prompts ?? []);

  if (output === 'json') {
    printJson(body);
    return;
  }

  if (prompts.length === 0) {
    process.stdout.write('No prompts found.\n');
    return;
  }

  const rows = prompts.map((p) => [referenceOf(p), p.version !== undefined ? String(p.version) : '']);
  printTable(['REFERENCE', 'VERSION'], rows);
}

export async function runPromptsGet(
  conn: Connection,
  output: OutputFormat,
  reference: string,
): Promise<void> {
  const prompt = await client(conn).get<Prompt>(`/v1/prompts/${encodeURIComponent(reference)}`);

  if (output === 'json') {
    printJson(prompt);
    return;
  }

  const pairs: [string, string][] = [['Reference', referenceOf(prompt) || reference]];
  if (prompt.version !== undefined) pairs.push(['Version', String(prompt.version)]);
  printKeyValues(pairs);

  if (typeof prompt.template === 'string') {
    process.stdout.write(`\n${prompt.template}\n`);
  } else if (prompt.messages && prompt.messages.length > 0) {
    process.stdout.write(`\n${JSON.stringify(prompt.messages, null, 2)}\n`);
  }
}

export async function runPromptsRender(
  conn: Connection,
  output: OutputFormat,
  reference: string,
  variables: Record<string, string>,
): Promise<void> {
  const rendered = await client(conn).post<RenderedPrompt>(
    `/v1/prompts/${encodeURIComponent(reference)}/render`,
    { variables },
  );

  if (output === 'json') {
    printJson(rendered);
    return;
  }

  if (typeof rendered.text === 'string') {
    process.stdout.write(`${rendered.text}\n`);
  } else if (rendered.messages && rendered.messages.length > 0) {
    process.stdout.write(`${JSON.stringify(rendered.messages, null, 2)}\n`);
  } else {
    printJson(rendered);
  }
}
