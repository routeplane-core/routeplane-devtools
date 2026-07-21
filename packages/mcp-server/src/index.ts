#!/usr/bin/env node
/**
 * @routeplane/mcp-server — a Model Context Protocol server that exposes the
 * Routeplane AI Gateway to MCP clients (Claude Code, Cursor, VS Code Copilot).
 *
 * Transport is stdio: JSON-RPC in on stdin, out on stdout. Diagnostics MUST go
 * to stderr — anything written to stdout corrupts the protocol stream.
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { resolveConfig } from './config.js';
import { createServer, SERVER_VERSION } from './server.js';

async function main(): Promise<void> {
  const config = resolveConfig(process.argv.slice(2), process.env);
  const server = createServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(
    `routeplane mcp-server v${SERVER_VERSION} ready (gateway ${config.baseUrl})\n`,
  );
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`routeplane mcp-server failed to start: ${message}\n`);
  process.exit(1);
});
