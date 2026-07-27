/**
 * Shared scaffolding for the MCP tool handlers: the tool-definition shape, the
 * client factory the handlers call through, JSON-Schema builders for tool
 * inputs, argument validators, and result/error formatting.
 */

import { ROUTING_STRATEGIES, RouteplaneCoreClient, RouteplaneError } from '@routeplane/sdk/core';
import type { RouteplaneHeaders } from '@routeplane/sdk/core';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

/** Builds a core client carrying the given `x-routeplane-*` routing headers as defaults. */
export type ClientFactory = (headers?: RouteplaneHeaders) => RouteplaneCoreClient;

export type ToolInputSchema = Tool['inputSchema'];

export type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: ToolInputSchema;
  /** Read-only tools (no side effects) — advertised via the MCP readOnlyHint. */
  readOnly?: boolean;
  /** Mutating tools whose effect is hard to undo — advertised via destructiveHint. */
  destructive?: boolean;
  handler: (make: ClientFactory, args: Record<string, unknown>) => Promise<ToolResult>;
}

// --- result helpers -------------------------------------------------------

export function textResult(text: string): ToolResult {
  return { content: [{ type: 'text', text }] };
}

export function jsonResult(value: unknown): ToolResult {
  return textResult(JSON.stringify(value, null, 2));
}

export function errorResult(message: string): ToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

/** Render any thrown error into an assistant-readable error result. */
export function formatError(err: unknown): ToolResult {
  if (err instanceof RouteplaneError) {
    const parts = [`Gateway error ${err.status}: ${err.message}`];
    if (err.requestId) parts.push(`request id: ${err.requestId}`);
    return errorResult(parts.join('\n'));
  }
  if (err instanceof Error) return errorResult(err.message);
  return errorResult(String(err));
}

// --- JSON Schema builders -------------------------------------------------

type SchemaProp = Record<string, unknown>;

const withDesc = (base: SchemaProp, description?: string): SchemaProp =>
  description ? { ...base, description } : base;

export const str = (description?: string): SchemaProp => withDesc({ type: 'string' }, description);
export const num = (description?: string): SchemaProp => withDesc({ type: 'number' }, description);
export const bool = (description?: string): SchemaProp => withDesc({ type: 'boolean' }, description);
export const strArray = (description?: string): SchemaProp =>
  withDesc({ type: 'array', items: { type: 'string' } }, description);
export const record = (description?: string): SchemaProp =>
  withDesc({ type: 'object', additionalProperties: true }, description);
export const enumStr = (values: string[], description?: string): SchemaProp =>
  withDesc({ type: 'string', enum: values }, description);

export function objectSchema(
  properties: Record<string, SchemaProp>,
  required: string[] = [],
): ToolInputSchema {
  return {
    type: 'object',
    properties,
    ...(required.length > 0 ? { required } : {}),
  };
}

export const EMPTY_SCHEMA: ToolInputSchema = { type: 'object', properties: {} };

// --- argument validators (system boundary — args come from the MCP client) --

export function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Missing or invalid "${key}": expected a non-empty string.`);
  }
  return value;
}

export function optString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new Error(`Invalid "${key}": expected a string.`);
  return value;
}

export function requireNumber(args: Record<string, unknown>, key: string): number {
  const value = args[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Missing or invalid "${key}": expected a number.`);
  }
  return value;
}

export function optNumber(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Invalid "${key}": expected a number.`);
  }
  return value;
}

export function optBool(args: Record<string, unknown>, key: string): boolean | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'boolean') throw new Error(`Invalid "${key}": expected a boolean.`);
  return value;
}

export function requireArray(args: Record<string, unknown>, key: string): unknown[] {
  const value = args[key];
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`Missing or invalid "${key}": expected a non-empty array.`);
  }
  return value;
}

export function optStringArray(args: Record<string, unknown>, key: string): string[] | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
    throw new Error(`Invalid "${key}": expected an array of strings.`);
  }
  return value as string[];
}

export function optRecord(
  args: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid "${key}": expected an object.`);
  }
  return value as Record<string, unknown>;
}

/** Build only the routing headers a client cares about, dropping undefined entries. */
export function routingHeaders(args: Record<string, unknown>): RouteplaneHeaders {
  const headers: RouteplaneHeaders = {};
  const provider = optString(args, 'provider');
  if (provider !== undefined) headers.provider = provider;
  const residency = optString(args, 'residency');
  if (residency !== undefined) headers.residency = residency;
  const strategy = optString(args, 'strategy');
  if (strategy !== undefined && (ROUTING_STRATEGIES as readonly string[]).includes(strategy)) {
    headers.strategy = strategy as (typeof ROUTING_STRATEGIES)[number];
  }
  return headers;
}
