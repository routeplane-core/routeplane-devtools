# routeplane-devtools

Developer tooling for the [Routeplane](https://routeplane.ai) AI Gateway — a neutral, multi-provider, OpenAI-compatible proxy with sovereign routing, governance, and agentic security.

This is a pnpm + Turborepo monorepo. Phase 1 ships the SDK core; the CLI and MCP server land in later phases.

| Package | What it is | Status |
| --- | --- | --- |
| [`@routeplane/sdk`](packages/sdk) | TypeScript SDK — drop-in OpenAI client + zero-dependency core client | **Phase 1 — available** |
| `@routeplane/cli` | `rp` command-line interface | Phase 2 — placeholder |
| `@routeplane/mcp-server` | Model Context Protocol server | Phase 3 — placeholder |

## The 30-second wow

`Routeplane` is a subclass of the official `openai` client. Point your existing OpenAI code at the gateway, change nothing else, and get multi-provider fallback, sovereign routing, and FinOps attribution for free:

```ts
import { Routeplane } from '@routeplane/sdk';

const client = new Routeplane({
  apiKey: process.env.ROUTEPLANE_API_KEY!, // rp_...
  provider: 'openai,anthropic',            // try OpenAI, fall back to Anthropic
  residency: 'IN',                         // keep regulated data in-region
  useCase: 'support-bot',                  // FinOps cost attribution
});

// Exactly the OpenAI SDK you already know:
const completion = await client.chat.completions.create({
  model: 'gpt-4o-mini',
  messages: [{ role: 'user', content: 'Say hello in one word.' }],
});
console.log(completion.choices[0]?.message.content);

// Steer a single request and read what the gateway decided:
const withMeta = await client.createChatCompletion(
  { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'Ping' }] },
  { strategy: 'cost', idempotencyKey: 'ping-1' },
);
console.log(withMeta.routeplane.provider); // which provider actually served it
console.log(withMeta.routeplane.cache);    // 'hit' | 'miss' | 'bypass'
```

### Zero-dependency core

If you don't want the `openai` peer dependency, import the core client and the typed header builder from `@routeplane/sdk/core`:

```ts
import { RouteplaneCoreClient, createHeaders } from '@routeplane/sdk/core';

const rp = new RouteplaneCoreClient({ apiKey: process.env.ROUTEPLANE_API_KEY! });

// Prompt management, logs, FinOps, cache, feedback — the non-OpenAI surfaces:
const usage = await rp.get('/v1/finops/usage', { from: '2026-07-01' });

// Build the x-routeplane-* headers yourself for any transport:
const headers = createHeaders({ provider: 'gemini', strategy: 'latency', residency: 'IN' });
```

## Examples

Runnable snippets live in [`examples/`](examples):

| File | Shows |
| --- | --- |
| [`basic.ts`](examples/basic.ts) | Minimal `Routeplane` client — a drop-in OpenAI subclass |
| [`headers-only.ts`](examples/headers-only.ts) | Stock `openai` SDK + `createHeaders` for per-request steering |
| [`streaming.ts`](examples/streaming.ts) | Streaming with the gateway's decision metadata |
| [`vercel-ai-sdk.ts`](examples/vercel-ai-sdk.ts) | Vercel AI SDK (`@ai-sdk/openai`) integration |
| [`resources.ts`](examples/resources.ts) | Non-OpenAI surfaces — status, logs, FinOps, prompts, cache |

See [`examples/`](examples) for more.

## Development

```bash
pnpm install
pnpm build   # turbo build across all packages
pnpm test    # vitest via turbo
pnpm lint    # tsc --noEmit type-check
```

Requires Node.js >= 18 (native `fetch`).

## License

[Apache-2.0](LICENSE)
