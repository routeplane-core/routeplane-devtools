/** Quality-feedback resource (`POST /v1/feedback`). */

import type { RouteplaneCoreClient } from '../client.js';

export interface FeedbackOptions {
  /** The gateway request id to score. */
  requestId: string;
  /** Integer score from -10 through 10, without rescaling. */
  score: number;
  /** Notes are unsupported; omit or pass null/empty. Nonempty text is rejected. */
  comment?: string | null;
}

export class FeedbackResource {
  constructor(private readonly client: RouteplaneCoreClient) {}

  /** Acknowledge legacy feedback; this does not prove target existence or durability. */
  async create(opts: FeedbackOptions): Promise<void> {
    if (typeof opts.score !== 'number') throw new TypeError('score must be a number');
    if (!Number.isInteger(opts.score) || opts.score < -10 || opts.score > 10) {
      throw new RangeError('score must be an integer from -10 through 10');
    }
    if (opts.comment !== undefined && opts.comment !== null) {
      if (typeof opts.comment !== 'string') throw new TypeError('comment must be a string or null');
      if (opts.comment !== '') throw new TypeError('comment is not supported by the legacy feedback endpoint');
    }
    const body = { trace_id: opts.requestId, value: opts.score };
    await this.client.post<unknown>('/v1/feedback', body);
  }
}
