/**
 * `rp feedback` — submit a legacy integer quality score for a prior
 * request via `POST /v1/feedback`.
 */

import { RouteplaneCoreClient } from '@routeplane/sdk/core';
import type { Connection } from '../resolve.js';
import { green } from '../output.js';

export interface FeedbackOptions {
  requestId: string;
  score: number;
  comment?: string | null;
}

/** Parse the CLI's textual score without coercing an empty argument to zero. */
export function parseFeedbackScore(value: string): number {
  const score = Number(value);
  if (value.trim() === '' || !Number.isInteger(score) || score < -10 || score > 10) {
    throw new Error('--score must be an integer from -10 through 10');
  }
  return score;
}

export async function runFeedback(conn: Connection, opts: FeedbackOptions): Promise<void> {
  const client = new RouteplaneCoreClient({ apiKey: conn.apiKey, baseUrl: conn.baseUrl });
  await client.feedback.create(opts);
  process.stdout.write(`${green('✓')} Feedback acknowledged for ${opts.requestId}.\n`);
}
