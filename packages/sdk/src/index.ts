/**
 * `@routeplane/sdk` main entry — re-exports everything.
 *
 * The `Routeplane` OpenAI client requires the optional `openai` peer dependency.
 * For a zero-dependency footprint, import from `@routeplane/sdk/core` instead,
 * which excludes the OpenAI surface.
 */

export * from './core/index.js';
export { Routeplane } from './openai/index.js';
export type { RouteplaneClientOptions, ChatCompletionWithMeta } from './openai/client.js';
