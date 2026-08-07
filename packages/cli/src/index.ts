#!/usr/bin/env node
/**
 * `rp` — the Routeplane AI Gateway command-line interface.
 *
 * Thin argument-parsing shell over `@routeplane/sdk/core`: it resolves a
 * connection (flag > env > profile), dispatches to a command, and renders the
 * result. All gateway I/O lives in the SDK; this package only formats.
 */

import { Command } from 'commander';
import { RouteplaneError } from '@routeplane/sdk/core';
import { runInit } from './commands/init.js';
import { runChat } from './commands/chat.js';
import { runStatus } from './commands/status.js';
import { runModelsList } from './commands/models.js';
import { runLogs } from './commands/logs.js';
import { runUsage } from './commands/usage.js';
import { runEmbed } from './commands/embed.js';
import { runPromptsList, runPromptsGet, runPromptsRender } from './commands/prompts.js';
import { runProvidersList } from './commands/providers.js';
import { runCachePurge } from './commands/cache.js';
import { runFeedback } from './commands/feedback.js';
import { runResidency } from './commands/residency.js';
import {
  runAgentsRuns,
  runAgentsEvents,
  runAgentsPending,
  runAgentsResolve,
} from './commands/agents.js';
import { runEval, runEvalRubrics, SuiteError } from './commands/eval.js';
import { runLogin } from './commands/login.js';
import {
  runKeysList,
  runKeysCreate,
  runKeysRotate,
  runKeysRevoke,
} from './commands/keys.js';
import { runTenantsList, runTenantsGet, runTenantsCreate } from './commands/tenants.js';
import { resolveConnection, resolveOutput, ResolutionError, type GlobalFlags } from './resolve.js';
import { dim, red } from './output.js';

/** The active profile name from the global `--profile` flag (default `default`). */
function profileOf(globals: GlobalFlags): string {
  return globals.profile ?? 'default';
}

/** Collect a repeated `--var key=value` flag into an accumulating array. */
function collectVar(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

/** Parse `["k=v", ...]` (as produced by `collectVar`) into a variables object. */
function parseVars(pairs: string[]): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const pair of pairs) {
    const eq = pair.indexOf('=');
    if (eq === -1) throw new Error(`invalid --var "${pair}" — expected key=value`);
    vars[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  return vars;
}

const program = new Command();

program
  .name('rp')
  .description('Routeplane AI Gateway CLI')
  .version('0.1.0')
  .option('--profile <name>', 'config profile to use', 'default')
  .option('--base-url <url>', 'override the gateway base URL')
  .option('--api-key <key>', 'override the API key (or set ROUTEPLANE_API_KEY)')
  .option('--output <format>', 'output format: table | json', 'table');

program
  .command('init')
  .description('interactive setup — save a connection profile to ~/.routeplane/config.json')
  .action(async () => {
    await runInit();
  });

program
  .command('chat [message]')
  .description('stream a chat completion (reads stdin when no message is given)')
  .option('--model <model>', 'model to use', 'gpt-4o')
  .option('--provider <provider>', 'provider name or comma-separated fallback chain')
  .option('--strategy <strategy>', 'routing strategy: priority | weighted | cost | latency')
  .option('--residency <region>', 'data-residency region (e.g. IN)')
  .option('--system <prompt>', 'system prompt')
  .option('--json', 'emit raw JSON chunks instead of plain text')
  .action(async (message: string | undefined, options, command: Command) => {
    const globals = command.optsWithGlobals() as GlobalFlags;
    const conn = resolveConnection(globals);
    await runChat(conn, {
      message,
      model: options.model,
      provider: options.provider,
      strategy: options.strategy,
      residency: options.residency,
      system: options.system,
      json: Boolean(options.json),
    });
  });

program
  .command('status')
  .description('show gateway health')
  .option('--json', 'raw JSON output')
  .action(async (options, command: Command) => {
    const globals = command.optsWithGlobals() as GlobalFlags;
    const conn = resolveConnection(globals);
    await runStatus(conn, resolveOutput(globals, Boolean(options.json)));
  });

const models = program.command('models').description('model catalog');
models
  .command('list')
  .description('list available models')
  .option('--provider <provider>', 'filter by owning provider')
  .option('--json', 'raw JSON output')
  .action(async (options, command: Command) => {
    const globals = command.optsWithGlobals() as GlobalFlags;
    const conn = resolveConnection(globals);
    await runModelsList(conn, resolveOutput(globals, Boolean(options.json)), options.provider);
  });

program
  .command('logs')
  .description('show recent request logs')
  .option('--limit <n>', 'maximum number of logs to return', '50')
  .option('--json', 'raw JSON output')
  .action(async (options, command: Command) => {
    const globals = command.optsWithGlobals() as GlobalFlags;
    const conn = resolveConnection(globals);
    const limit = Number.parseInt(options.limit, 10);
    if (!Number.isFinite(limit) || limit <= 0) throw new Error('--limit must be a positive integer');
    await runLogs(conn, resolveOutput(globals, Boolean(options.json)), limit);
  });

program
  .command('usage')
  .description('FinOps usage summary')
  .option('--from <date>', 'start date (YYYY-MM-DD)')
  .option('--to <date>', 'end date (YYYY-MM-DD)')
  .option('--json', 'raw JSON output')
  .action(async (options, command: Command) => {
    const globals = command.optsWithGlobals() as GlobalFlags;
    const conn = resolveConnection(globals);
    await runUsage(conn, resolveOutput(globals, Boolean(options.json)), {
      from: options.from,
      to: options.to,
    });
  });

program
  .command('embed [text]')
  .description('generate an embedding (reads stdin when no text is given)')
  .option('--model <model>', 'embedding model', 'text-embedding-3-small')
  .option('--provider <provider>', 'provider name or comma-separated fallback chain')
  .option('--json', 'raw JSON output')
  .action(async (text: string | undefined, options, command: Command) => {
    const globals = command.optsWithGlobals() as GlobalFlags;
    const conn = resolveConnection(globals);
    await runEmbed(conn, resolveOutput(globals, Boolean(options.json)), {
      text,
      model: options.model,
      provider: options.provider,
    });
  });

const prompts = program.command('prompts').description('prompt-template management');
prompts
  .command('list')
  .description('list prompt templates')
  .option('--json', 'raw JSON output')
  .action(async (options, command: Command) => {
    const globals = command.optsWithGlobals() as GlobalFlags;
    const conn = resolveConnection(globals);
    await runPromptsList(conn, resolveOutput(globals, Boolean(options.json)));
  });
prompts
  .command('get <reference>')
  .description('fetch a prompt template')
  .option('--json', 'raw JSON output')
  .action(async (reference: string, options, command: Command) => {
    const globals = command.optsWithGlobals() as GlobalFlags;
    const conn = resolveConnection(globals);
    await runPromptsGet(conn, resolveOutput(globals, Boolean(options.json)), reference);
  });
prompts
  .command('render <reference>')
  .description('render a prompt template with variables')
  .option('--var <key=value>', 'template variable (repeatable)', collectVar, [])
  .option('--json', 'raw JSON output')
  .action(async (reference: string, options, command: Command) => {
    const globals = command.optsWithGlobals() as GlobalFlags;
    const conn = resolveConnection(globals);
    await runPromptsRender(
      conn,
      resolveOutput(globals, Boolean(options.json)),
      reference,
      parseVars(options.var as string[]),
    );
  });

const providers = program.command('providers').description('custom OpenAI-compatible providers');
providers
  .command('list')
  .description('list registered providers')
  .option('--json', 'raw JSON output')
  .action(async (options, command: Command) => {
    const globals = command.optsWithGlobals() as GlobalFlags;
    const conn = resolveConnection(globals);
    await runProvidersList(conn, resolveOutput(globals, Boolean(options.json)));
  });

const cache = program.command('cache').description('response cache');
cache
  .command('purge')
  .description('purge the response cache')
  .action(async (_options, command: Command) => {
    const globals = command.optsWithGlobals() as GlobalFlags;
    const conn = resolveConnection(globals);
    await runCachePurge(conn);
  });

program
  .command('feedback')
  .description('submit quality feedback on a request')
  .requiredOption('--request-id <id>', 'the gateway request id to score')
  .requiredOption('--score <score>', 'quality score (number)')
  .option('--comment <text>', 'free-text comment')
  .action(async (options, command: Command) => {
    const globals = command.optsWithGlobals() as GlobalFlags;
    const conn = resolveConnection(globals);
    const score = Number(options.score);
    if (!Number.isFinite(score)) throw new Error('--score must be a number');
    await runFeedback(conn, { requestId: options.requestId, score, comment: options.comment });
  });

program
  .command('residency')
  .description('sovereign-routing summary')
  .option('--json', 'raw JSON output')
  .action(async (options, command: Command) => {
    const globals = command.optsWithGlobals() as GlobalFlags;
    const conn = resolveConnection(globals);
    await runResidency(conn, resolveOutput(globals, Boolean(options.json)));
  });

const agents = program
  .command('agents')
  .description('agentic security — agent runs, enforcement events, and the approval queue');
agents
  .command('runs')
  .description('list recent agent runs')
  .option('--json', 'raw JSON output')
  .action(async (options, command: Command) => {
    const globals = command.optsWithGlobals() as GlobalFlags;
    const conn = resolveConnection(globals);
    await runAgentsRuns(conn, resolveOutput(globals, Boolean(options.json)));
  });
agents
  .command('events')
  .description('list recent MCP enforcement events (denials)')
  .option('--json', 'raw JSON output')
  .action(async (options, command: Command) => {
    const globals = command.optsWithGlobals() as GlobalFlags;
    const conn = resolveConnection(globals);
    await runAgentsEvents(conn, resolveOutput(globals, Boolean(options.json)));
  });
agents
  .command('pending')
  .description('list tool calls held for human approval')
  .option('--json', 'raw JSON output')
  .action(async (options, command: Command) => {
    const globals = command.optsWithGlobals() as GlobalFlags;
    const conn = resolveConnection(globals);
    await runAgentsPending(conn, resolveOutput(globals, Boolean(options.json)));
  });
agents
  .command('approve <id>')
  .description('approve a held tool call')
  .option('--note <text>', 'operator note')
  .option('--json', 'raw JSON output')
  .action(async (id: string, options, command: Command) => {
    const globals = command.optsWithGlobals() as GlobalFlags;
    const conn = resolveConnection(globals);
    await runAgentsResolve(conn, resolveOutput(globals, Boolean(options.json)), 'approve', id, options.note);
  });
agents
  .command('deny <id>')
  .description('deny a held tool call')
  .option('--note <text>', 'operator note')
  .option('--json', 'raw JSON output')
  .action(async (id: string, options, command: Command) => {
    const globals = command.optsWithGlobals() as GlobalFlags;
    const conn = resolveConnection(globals);
    await runAgentsResolve(conn, resolveOutput(globals, Boolean(options.json)), 'deny', id, options.note);
  });

// ---------------------------------------------------------------------------
// Control Plane admin commands (separate binary, Entra ID OIDC auth)
// ---------------------------------------------------------------------------

program
  .command('login')
  .description('authenticate with the Control Plane (OAuth device-code flow)')
  .option('--cp-url <url>', 'Control Plane base URL')
  .option('--cp-tenant-id <id>', 'Entra directory (tenant) id')
  .option('--cp-client-id <id>', 'Entra application (client) id')
  .option('--scope <scope>', 'OAuth scope to request')
  .action(async (options, command: Command) => {
    const globals = command.optsWithGlobals() as GlobalFlags;
    await runLogin(profileOf(globals), {
      cpUrl: options.cpUrl,
      cpTenantId: options.cpTenantId,
      cpClientId: options.cpClientId,
      scope: options.scope,
    });
  });

const keys = program.command('keys').description('virtual-key administration (Control Plane)');
keys
  .command('list')
  .description('list virtual keys for a tenant')
  .option('--tenant-id <id>', 'tenant to list keys for (defaults to the profile default)')
  .option('--json', 'raw JSON output')
  .action(async (options, command: Command) => {
    const globals = command.optsWithGlobals() as GlobalFlags;
    await runKeysList(profileOf(globals), resolveOutput(globals, Boolean(options.json)), options.tenantId);
  });
keys
  .command('create')
  .description('create a new virtual key (shows the full value once)')
  .option('--tenant-id <id>', 'tenant to create the key under')
  .option('--name <name>', 'a human label for the key')
  .option('--json', 'raw JSON output')
  .action(async (options, command: Command) => {
    const globals = command.optsWithGlobals() as GlobalFlags;
    await runKeysCreate(
      profileOf(globals),
      resolveOutput(globals, Boolean(options.json)),
      options.tenantId,
      options.name,
    );
  });
keys
  .command('rotate')
  .description('rotate a key — issues a new value; the old one keeps a 30-day grace period')
  .requiredOption('--key-id <id>', 'the key to rotate')
  .option('--tenant-id <id>', 'tenant that owns the key')
  .option('--json', 'raw JSON output')
  .action(async (options, command: Command) => {
    const globals = command.optsWithGlobals() as GlobalFlags;
    await runKeysRotate(
      profileOf(globals),
      resolveOutput(globals, Boolean(options.json)),
      options.tenantId,
      options.keyId,
    );
  });
keys
  .command('revoke')
  .description('revoke a key immediately')
  .requiredOption('--key-id <id>', 'the key to revoke')
  .option('--tenant-id <id>', 'tenant that owns the key')
  .option('--force', 'skip the confirmation prompt')
  .option('--json', 'raw JSON output')
  .action(async (options, command: Command) => {
    const globals = command.optsWithGlobals() as GlobalFlags;
    await runKeysRevoke(
      profileOf(globals),
      resolveOutput(globals, Boolean(options.json)),
      options.tenantId,
      options.keyId,
      Boolean(options.force),
    );
  });

const tenants = program.command('tenants').description('tenant administration (Control Plane)');
tenants
  .command('list')
  .description('list tenants')
  .option('--json', 'raw JSON output')
  .action(async (options, command: Command) => {
    const globals = command.optsWithGlobals() as GlobalFlags;
    await runTenantsList(profileOf(globals), resolveOutput(globals, Boolean(options.json)));
  });
tenants
  .command('get <tenant-id>')
  .description('show tenant details')
  .option('--json', 'raw JSON output')
  .action(async (tenantId: string, options, command: Command) => {
    const globals = command.optsWithGlobals() as GlobalFlags;
    await runTenantsGet(profileOf(globals), resolveOutput(globals, Boolean(options.json)), tenantId);
  });
tenants
  .command('create')
  .description('create a tenant')
  .requiredOption('--name <name>', 'tenant display name')
  .option('--tier <tier>', 'entitlement tier (e.g. standard)')
  .option('--json', 'raw JSON output')
  .action(async (options, command: Command) => {
    const globals = command.optsWithGlobals() as GlobalFlags;
    await runTenantsCreate(profileOf(globals), resolveOutput(globals, Boolean(options.json)), {
      name: options.name,
      tier: options.tier,
    });
  });

const evaluate = program
  .command('eval')
  .description('run an evaluation suite (deterministic — calls no model)');
evaluate
  .command('run <suite-file>', { isDefault: true })
  .description('score a JSON suite file and gate on its thresholds')
  .option('--json', 'raw JSON output')
  .action(async (suiteFile: string, options, command: Command) => {
    const globals = command.optsWithGlobals() as GlobalFlags;
    const conn = resolveConnection(globals);
    await runEval(conn, resolveOutput(globals, Boolean(options.json)), suiteFile);
  });
evaluate
  .command('rubrics')
  .description('list the built-in judge rubrics')
  .option('--category <category>', 'filter to one category (e.g. security)')
  .option('--json', 'raw JSON output')
  .action(async (options, command: Command) => {
    const globals = command.optsWithGlobals() as GlobalFlags;
    const conn = resolveConnection(globals);
    await runEvalRubrics(
      conn,
      resolveOutput(globals, Boolean(options.json)),
      options.category as string | undefined,
    );
  });

async function main(): Promise<void> {
  await program.parseAsync(process.argv);
}

main().catch((err: unknown) => {
  // A broken suite file exits 2, distinct from the 1 a missed threshold uses.
  // A build gate has to tell "quality dropped" from "the config is wrong": the
  // first should fail the build loudly, the second is a bug in the gate itself,
  // and collapsing both into 1 trains people to ignore the signal.
  if (err instanceof SuiteError) {
    process.stderr.write(`${red('Error')}: ${err.message}\n`);
    process.exit(2);
  }
  if (err instanceof RouteplaneError) {
    const rid = err.requestId ? dim(` (request ${err.requestId})`) : '';
    process.stderr.write(`${red('Error')}: ${err.message}${rid}\n`);
  } else if (err instanceof ResolutionError || err instanceof Error) {
    process.stderr.write(`${red('Error')}: ${err.message}\n`);
  } else {
    process.stderr.write(`${red('Error')}: ${String(err)}\n`);
  }
  process.exit(1);
});
