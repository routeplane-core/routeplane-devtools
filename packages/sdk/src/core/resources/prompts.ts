/** Prompt-management resource (`/v1/prompts/*`). */

import type { RouteplaneCoreClient } from '../client.js';
import { createHeaders } from '../headers.js';
import type { Completion, Prompt, RenderedPrompt } from '../models.js';

export interface PromptCompleteOptions {
  /** Template variables to substitute. */
  variables?: Record<string, string>;
  /** Model override, threaded into the completion request body. */
  model?: string;
  /** Provider (or fallback chain) override, sent as `x-routeplane-provider`. */
  provider?: string;
}

export class PromptResource {
  constructor(private readonly client: RouteplaneCoreClient) {}

  /** Fetch a stored prompt template by reference. */
  get(reference: string): Promise<Prompt> {
    return this.client.get<Prompt>(`/v1/prompts/${encodeURIComponent(reference)}`);
  }

  /** Render a template with variables, without running a completion. */
  render(reference: string, variables?: Record<string, string>): Promise<RenderedPrompt> {
    return this.client.post<RenderedPrompt>(
      `/v1/prompts/${encodeURIComponent(reference)}/render`,
      { variables: variables ?? {} },
    );
  }

  /** Render and run a completion in one call. */
  async complete(reference: string, opts: PromptCompleteOptions = {}): Promise<Completion> {
    const body: Record<string, unknown> = {};
    if (opts.variables !== undefined) body.variables = opts.variables;
    if (opts.model !== undefined) body.model = opts.model;
    const extraHeaders =
      opts.provider !== undefined ? createHeaders({ provider: opts.provider }) : undefined;
    const { data } = await this.client.postWithMeta<Completion>(
      `/v1/prompts/${encodeURIComponent(reference)}/completions`,
      body,
      extraHeaders,
    );
    return data;
  }
}
