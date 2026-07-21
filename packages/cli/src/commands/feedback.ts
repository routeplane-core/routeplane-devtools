/**
 * `rp feedback` — attach a quality score (and optional comment) to a prior
 * request via `POST /v1/feedback`.
 */

import { RouteplaneCoreClient } from '@routeplane/sdk/core';
import type { Connection } from '../resolve.js';
import { green } from '../output.js';

export interface FeedbackOptions {
  requestId: string;
  score: number;
  comment?: string;
}

export async function runFeedback(conn: Connection, opts: FeedbackOptions): Promise<void> {
  const client = new RouteplaneCoreClient({ apiKey: conn.apiKey, baseUrl: conn.baseUrl });
  const body: Record<string, unknown> = { request_id: opts.requestId, score: opts.score };
  if (opts.comment !== undefined) body.comment = opts.comment;
  await client.post<unknown>('/v1/feedback', body);
  process.stdout.write(`${green('✓')} Feedback recorded for ${opts.requestId}.\n`);
}
