/**
 * Evaluations resource (`/v1/evaluations/*`) — requires the `evaluations`
 * entitlement.
 *
 * Two different things live behind this one prefix, and the difference matters
 * when you are deciding which to call:
 *
 * - {@link EvaluationsResource.score} is **synchronous and deterministic**. You
 *   send outputs, you get scores back in the same response. No model is
 *   involved, nothing is stored, and nothing is persisted — it is the one that
 *   belongs in a CI job.
 * - {@link EvaluationsResource.list} reads **past judge scores** the gateway
 *   persisted from an operator-armed evaluation run. Those runs are configured
 *   on the gateway side, not from here.
 *
 * {@link EvaluationsResource.rubrics} lists the built-in judge rubrics, which
 * are for configuring one of those armed runs. Calling it does not run a judge.
 */

import type { RouteplaneCoreClient } from '../client.js';
import type { EvalScoreResponse, EvaluationsPage, RubricCatalog } from '../models.js';

/** One thing to score. */
export interface EvalCase {
  /** Your identifier, echoed back on the result so you can join it to source. */
  id?: string;
  /** The output under test. */
  output: string;
  /** The expected output, for evaluators that compare against one. */
  reference?: string;
  /** The agent's tool-call trajectory, for the trajectory evaluator. */
  trajectory?: EvalMessage[];
  /** The reference trajectory to compare against. */
  reference_trajectory?: EvalMessage[];
}

/** A message in a trajectory. Content is never compared — only tool calls. */
export interface EvalMessage {
  role: string;
  content: string;
  tool_calls?: EvalToolCall[];
}

/** One tool call: the name invoked and its raw argument blob. */
export interface EvalToolCall {
  name: string;
  /** Usually a JSON object, as the model emitted it. */
  arguments: string;
}

/**
 * How one tool's arguments are compared: a mode, or an explicit list of dotted
 * paths that are the only thing compared.
 *
 * `on_keys` is the escape hatch for real agents — a booking tool carries a
 * timestamp that changes every run, and the flight number is the actual
 * assertion.
 */
export type ToolArgsMatcher =
  | { type: 'mode'; mode: 'exact' | 'ignore' | 'subset' | 'superset' }
  | { type: 'on_keys'; paths: string[] };

/** Which check to run. The reference lives on the CASE, not on the evaluator. */
export type EvaluatorSpec =
  | { type: 'exact_match' }
  | { type: 'canonical_json_match' }
  | { type: 'levenshtein_similarity'; threshold?: number }
  | { type: 'valid_json' }
  | { type: 'contains'; needle: string }
  | { type: 'required_json_keys'; keys: string[] }
  | {
      type: 'json_match';
      exclude_keys?: string[];
      aggregator?: 'average' | 'all';
      list_match_mode?: 'same_elements' | 'subset' | 'superset' | 'ordered';
    }
  | {
      type: 'trajectory_match';
      match_mode: 'strict' | 'unordered' | 'subset' | 'superset';
      tool_args_match_mode?: 'exact' | 'ignore' | 'subset' | 'superset';
      overrides?: Record<string, ToolArgsMatcher>;
    };

/** Options for {@link EvaluationsResource.list}. */
export interface EvaluationsListOptions {
  /** Inclusive ISO start date (`YYYY-MM-DD`). */
  from?: string;
  /** Inclusive ISO end date (`YYYY-MM-DD`). */
  to?: string;
  /** Filter to one rubric code. */
  rubric?: string;
  /** Filter to one judge variant. */
  judgeVariant?: string;
  /** Filter to passed or failed scores only. */
  passed?: boolean;
  /** Max rows to return. */
  limit?: number;
}

export class EvaluationsResource {
  constructor(private readonly client: RouteplaneCoreClient) {}

  /**
   * Score outputs deterministically and get the results back in the response.
   *
   * Makes no model call, so there is no per-case token cost and no
   * non-determinism: the same inputs score the same every time. That is what
   * makes it usable as a build gate.
   *
   * A case that lacks the input a check needs (no `reference` for
   * `exact_match`, no trajectory for `trajectory_match`) is reported as
   * SKIPPED, not failed, and skips are excluded from the summary's rates.
   */
  score(cases: EvalCase[], evaluators: EvaluatorSpec[]): Promise<EvalScoreResponse> {
    return this.client.post<EvalScoreResponse>('/v1/evaluations/score', {
      cases,
      evaluators,
    });
  }

  /**
   * The built-in judge rubrics, for configuring an armed evaluation run.
   *
   * Read-only, and it does NOT run a judge. Each entry lists the variables its
   * rubric needs; a run whose records cannot supply one is refused rather than
   * scored against an empty value.
   */
  rubrics(): Promise<RubricCatalog> {
    return this.client.get<RubricCatalog>('/v1/evaluations/rubrics');
  }

  /**
   * Past judge scores from armed evaluation runs.
   *
   * Days with no run are honestly absent rather than zero-filled. A pass rate
   * here is not a statement about agreement with human judgement — that is a
   * separate, per-rubric calibration property.
   */
  list(options: EvaluationsListOptions = {}): Promise<EvaluationsPage> {
    const params: Record<string, string> = {};
    if (options.from) params.from = options.from;
    if (options.to) params.to = options.to;
    if (options.rubric) params.rubric = options.rubric;
    if (options.judgeVariant) params.judge_variant = options.judgeVariant;
    if (options.passed !== undefined) params.passed = String(options.passed);
    if (options.limit !== undefined) params.limit = String(options.limit);
    return this.client.get<EvaluationsPage>('/v1/evaluations', params);
  }
}
