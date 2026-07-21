/**
 * Builds the MCP server: registers the 33 curated tools and 3 read-only
 * resources against the low-level `Server`, dispatching each call through a
 * per-request Routeplane core client so routing headers can vary per tool call.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { RouteplaneCoreClient } from '@routeplane/sdk/core';
import type { RouteplaneHeaders } from '@routeplane/sdk/core';

import type { ResolvedConfig } from './config.js';
import { allTools } from './tools/index.js';
import { type ClientFactory, formatError } from './tools/common.js';

export const SERVER_NAME = 'routeplane';
export const SERVER_VERSION = '0.1.0';

interface ResourceDef {
  uri: string;
  name: string;
  description: string;
  path: string;
}

const RESOURCES: ResourceDef[] = [
  {
    uri: 'routeplane://models',
    name: 'Model catalog',
    description: 'The models available through the gateway.',
    path: '/v1/models',
  },
  {
    uri: 'routeplane://providers',
    name: 'Custom providers',
    description: 'Self-registered OpenAI-compatible providers.',
    path: '/v1/providers',
  },
  {
    uri: 'routeplane://status',
    name: 'Gateway status',
    description: 'Health, version, and per-provider circuit state.',
    path: '/status',
  },
];

export function createServer(config: ResolvedConfig): Server {
  const make: ClientFactory = (headers?: RouteplaneHeaders) =>
    new RouteplaneCoreClient({ apiKey: config.apiKey, baseUrl: config.baseUrl, headers });

  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {}, resources: {} } },
  );

  const toolsByName = new Map(allTools.map((tool) => [tool.name, tool]));

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: allTools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      annotations: {
        readOnlyHint: tool.readOnly ?? false,
        ...(tool.destructive ? { destructiveHint: true } : {}),
        openWorldHint: true,
      },
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    const tool = toolsByName.get(request.params.name);
    if (!tool) {
      return {
        content: [{ type: 'text', text: `Unknown tool: ${request.params.name}` }],
        isError: true,
      };
    }
    try {
      return await tool.handler(make, request.params.arguments ?? {});
    } catch (err) {
      return formatError(err);
    }
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: RESOURCES.map((resource) => ({
      uri: resource.uri,
      name: resource.name,
      description: resource.description,
      mimeType: 'application/json',
    })),
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const resource = RESOURCES.find((entry) => entry.uri === request.params.uri);
    if (!resource) {
      throw new Error(`Unknown resource: ${request.params.uri}`);
    }
    const data = await make().get(resource.path);
    return {
      contents: [
        {
          uri: resource.uri,
          mimeType: 'application/json',
          text: JSON.stringify(data, null, 2),
        },
      ],
    };
  });

  return server;
}
