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
import { resolveConnection, resolveOutput, ResolutionError, type GlobalFlags } from './resolve.js';
import { dim, red } from './output.js';

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
