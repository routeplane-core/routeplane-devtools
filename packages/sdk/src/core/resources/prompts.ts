/** Prompt-management resource (`/v1/prompts/*`). */

import type { RouteplaneCoreClient } from '../client.js';
import { createHeaders } from '../headers.js';
import type { Completion, Prompt, RenderedPrompt } from '../models.js';

/**
 * Template variables. Values are any JSON — the gateway substitutes objects and
 * numbers as readily as strings.
 */
export type PromptVariables = Record<string, unknown>;

/**
 * What to do when the template references a variable the caller did not supply.
 * The gateway defaults to `error`; `empty` substitutes an empty string instead.
 */
export type MissingVariablePolicy = 'error' | 'empty';

export interface PromptRenderOptions {
  /** Missing-variable policy. Defaults to the gateway's `error`. */
  missing?: MissingVariablePolicy;
  /**
   * A/B cohort key, sent as `x-routeplane-cohort`. Assignment is sticky per
   * cohort key, so pass a stable caller-chosen identity. Absent means the
   * experiment serves its control arm.
   */
  cohort?: string;
}

export interface PromptCompleteOptions extends PromptRenderOptions {
  /** Template variables to substitute. */
  variables?: PromptVariables;
  /** Model override, threaded into the completion request body. */
  model?: string;
  /** Provider (or fallback chain) override, sent as `x-routeplane-provider`. */
  provider?: string;
  /**
   * Further chat-request fields merged into the body (`temperature`,
   * `max_tokens`, `stream`, `user`, …). Body fields win over the prompt
   * version's `default_params` and `default_model`; `messages` is always the
   * rendered template and cannot be overridden.
   *
   * Routing options do not belong here. The gateway flattens this body into a
   * chat request, which ignores fields it does not know — so a `provider` put
   * here would be dropped silently rather than rejected. Use the typed
   * `provider` and `cohort` options, which travel as headers.
   */
  overrides?: Record<string, unknown>;
}

export class PromptResource {
  constructor(private readonly client: RouteplaneCoreClient) {}

  /** Fetch a stored prompt template by reference. */
  get(reference: string): Promise<Prompt> {
    return this.client.get<Prompt>(`/v1/prompts/${encodeURIComponent(reference)}`);
  }

  /** Render a template with variables, without running a completion. */
  async render(
    reference: string,
    variables?: PromptVariables,
    opts: PromptRenderOptions = {},
  ): Promise<RenderedPrompt> {
    const body: Record<string, unknown> = { variables: variables ?? {} };
    if (opts.missing !== undefined) body.missing = opts.missing;
    const { data } = await this.client.postWithMeta<RenderedPrompt>(
      `/v1/prompts/${encodeURIComponent(reference)}/render`,
      body,
      opts.cohort !== undefined ? createHeaders({ cohort: opts.cohort }) : undefined,
    );
    return data;
  }

  /** Render and run a completion in one call. */
  async complete(reference: string, opts: PromptCompleteOptions = {}): Promise<Completion> {
    const body: Record<string, unknown> = { ...(opts.overrides ?? {}) };
    if (opts.variables !== undefined) body.variables = opts.variables;
    if (opts.missing !== undefined) body.missing = opts.missing;
    if (opts.model !== undefined) body.model = opts.model;

    const headers = createHeaders({
      ...(opts.provider !== undefined ? { provider: opts.provider } : {}),
      ...(opts.cohort !== undefined ? { cohort: opts.cohort } : {}),
    });
    const { data } = await this.client.postWithMeta<Completion>(
      `/v1/prompts/${encodeURIComponent(reference)}/completions`,
      body,
      Object.keys(headers).length > 0 ? headers : undefined,
    );
    return data;
  }
}
