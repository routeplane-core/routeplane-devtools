/**
 * `rp eval` — run an evaluation suite and fail the build when quality drops.
 *
 * The suite is a JSON file: the cases you want scored and the checks to run
 * over them. Everything here is deterministic — no model is called, so a run
 * costs nothing per case and scores identically every time. That is the whole
 * point: a gate that is itself non-deterministic is not a gate.
 *
 * JSON rather than YAML on purpose. This package ships to npm with exactly one
 * dependency, and a YAML parser is a supply-chain surface that a machine-read
 * config file does not justify.
 *
 * Exit codes:
 *   0  every threshold met
 *   1  a threshold was missed (the build-gate signal)
 *   2  the suite file or the gateway rejected the request
 */

import { readFileSync } from 'node:fs';
import {
  RouteplaneCoreClient,
  type EvalCase,
  type EvalEvaluatorSummary,
  type EvaluatorSpec,
  type RubricCatalog,
} from '@routeplane/sdk/core';
import type { Connection, OutputFormat } from '../resolve.js';
import { dim, green, printJson, printTable, red } from '../output.js';

/** The suite file's shape. */
interface EvalSuite {
  /** Optional suite name, shown in the summary line. */
  name?: string;
  cases: EvalCase[];
  evaluators: EvaluatorSpec[];
  /**
   * Minimum acceptable mean score per evaluator code, e.g.
   * `{"levenshtein_similarity": 0.9}`. An evaluator with no threshold is
   * reported but never fails the run — reporting and gating are separate
   * decisions, and conflating them makes people delete checks instead of
   * fixing them.
   */
  thresholds?: Record<string, number>;
}

/** A suite file that could not be used, with the reason a human needs. */
class SuiteError extends Error {}

/** Read and structurally validate the suite file. */
function loadSuite(path: string): EvalSuite {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (error) {
    throw new SuiteError(`cannot read suite file "${path}": ${(error as Error).message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new SuiteError(`"${path}" is not valid JSON: ${(error as Error).message}`);
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new SuiteError(`"${path}" must contain a JSON object`);
  }
  const suite = parsed as Partial<EvalSuite>;
  if (!Array.isArray(suite.cases) || suite.cases.length === 0) {
    throw new SuiteError(`"${path}" must define a non-empty "cases" array`);
  }
  if (!Array.isArray(suite.evaluators) || suite.evaluators.length === 0) {
    throw new SuiteError(`"${path}" must define a non-empty "evaluators" array`);
  }
  // Catch a threshold on an evaluator the suite never runs. Silently ignoring
  // it is the worst outcome: the gate reads as configured and enforces nothing,
  // so a typo'd key disables a check without anyone noticing.
  const codes = new Set(suite.evaluators.map(evaluatorCode));
  for (const key of Object.keys(suite.thresholds ?? {})) {
    if (!codes.has(key)) {
      throw new SuiteError(
        `threshold "${key}" names no evaluator in this suite — ` +
          `expected one of: ${[...codes].sort().join(', ')}`,
      );
    }
  }
  return suite as EvalSuite;
}

/**
 * The code an evaluator spec reports under — the same closed vocabulary the
 * gateway persists, so a CI score and a production score are comparable.
 */
function evaluatorCode(spec: EvaluatorSpec): string {
  return spec.type === 'trajectory_match' ? `trajectory_${spec.match_mode}_match` : spec.type;
}

function fmt(value: number): string {
  return value.toFixed(3);
}

export async function runEval(
  conn: Connection,
  output: OutputFormat,
  suitePath: string,
): Promise<void> {
  const suite = loadSuite(suitePath);
  const client = new RouteplaneCoreClient({ apiKey: conn.apiKey, baseUrl: conn.baseUrl });
  const response = await client.evaluations.score(suite.cases, suite.evaluators);

  if (output === 'json') {
    printJson(response);
  }

  const thresholds = suite.thresholds ?? {};
  const summaries: EvalEvaluatorSummary[] = response.summary?.by_evaluator ?? [];
  const failures: string[] = [];

  const rows = summaries.map((s) => {
    const threshold = thresholds[s.evaluator];
    let verdict = dim('—');
    if (threshold !== undefined) {
      if (s.mean_score >= threshold) {
        verdict = green('PASS');
      } else {
        verdict = red('FAIL');
        failures.push(
          `${s.evaluator}: mean ${fmt(s.mean_score)} is below the ${fmt(threshold)} threshold`,
        );
      }
    }
    return [
      s.evaluator,
      String(s.n),
      String(s.n_passed),
      s.n_skipped > 0 ? String(s.n_skipped) : '',
      fmt(s.mean_score),
      threshold === undefined ? '' : fmt(threshold),
      verdict,
    ];
  });

  if (output !== 'json') {
    const title = suite.name ? `${suite.name} — ` : '';
    process.stdout.write(`${title}${suite.cases.length} case(s), ${summaries.length} evaluator(s)\n\n`);
    printTable(['EVALUATOR', 'N', 'PASSED', 'SKIPPED', 'MEAN', 'THRESHOLD', 'GATE'], rows);

    // Surface skips explicitly. They are excluded from the rates above, so a
    // suite quietly skipping most of its cases would otherwise show a healthy
    // mean over the handful it actually scored.
    const skipped = summaries.reduce((total, s) => total + s.n_skipped, 0);
    if (skipped > 0) {
      process.stdout.write(
        dim(
          `\n${skipped} check(s) skipped for missing inputs — not counted as failures, ` +
            `and not counted in the means above.\n`,
        ),
      );
    }
  }

  if (failures.length > 0) {
    if (output !== 'json') {
      process.stderr.write(red(`\n${failures.length} threshold(s) missed:\n`));
      for (const failure of failures) process.stderr.write(red(`  ${failure}\n`));
    }
    process.exitCode = 1;
    return;
  }

  if (output !== 'json' && Object.keys(thresholds).length === 0) {
    process.stdout.write(
      dim('\nNo thresholds set — reported only. Add "thresholds" to fail the build.\n'),
    );
  }
}

/** `rp eval rubrics` — the built-in judge rubrics, for arming an evaluation run. */
export async function runEvalRubrics(
  conn: Connection,
  output: OutputFormat,
  category?: string,
): Promise<void> {
  const client = new RouteplaneCoreClient({ apiKey: conn.apiKey, baseUrl: conn.baseUrl });
  const catalog: RubricCatalog = await client.evaluations.rubrics();

  const rubrics = category
    ? catalog.rubrics.filter((r) => r.category === category)
    : catalog.rubrics;

  if (output === 'json') {
    printJson({ ...catalog, rubrics });
    return;
  }
  if (rubrics.length === 0) {
    const known = [...new Set(catalog.rubrics.map((r) => r.category))].sort().join(', ');
    process.stdout.write(`No rubrics in category "${category}". Known categories: ${known}\n`);
    return;
  }
  printTable(
    ['CODE', 'CATEGORY', 'VARIABLES'],
    rubrics.map((r) => [r.code, r.category, r.variables.join(', ')]),
  );
  process.stdout.write(
    dim(
      '\nRubrics are scored by an operator-armed evaluation run on the gateway, ' +
        'not by `rp eval` — which is deterministic and calls no model.\n',
    ),
  );
}

export { SuiteError, loadSuite, evaluatorCode };
