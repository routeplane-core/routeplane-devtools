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
import { resolveConnection, resolveOutput, ResolutionError, type GlobalFlags } from './resolve.js';
import { dim, red } from './output.js';

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

async function main(): Promise<void> {
  await program.parseAsync(process.argv);
}

main().catch((err: unknown) => {
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
