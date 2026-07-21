/** Quality-feedback resource (`POST /v1/feedback`). */

import type { RouteplaneCoreClient } from '../client.js';

export interface FeedbackOptions {
  /** The gateway request id to score. */
  requestId: string;
  /** Quality score (e.g. 0-1, or a thumbs value as a number). */
  score: number;
  /** Optional free-text comment. */
  comment?: string;
}

export class FeedbackResource {
  constructor(private readonly client: RouteplaneCoreClient) {}

  /** Attach a quality score (and optional comment) to a prior request. */
  async create(opts: FeedbackOptions): Promise<void> {
    const body: Record<string, unknown> = { request_id: opts.requestId, score: opts.score };
    if (opts.comment !== undefined) body.comment = opts.comment;
    await this.client.post<unknown>('/v1/feedback', body);
  }
}
