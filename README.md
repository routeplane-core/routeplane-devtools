# routeplane-devtools

Developer tooling for the [Routeplane](https://routeplane.ai) AI Gateway — a neutral, multi-provider, OpenAI-compatible proxy with sovereign routing, governance, and agentic security.

This is a pnpm + Turborepo monorepo. All three packages are published with
[npm provenance attestations](https://docs.npmjs.com/generating-provenance-statements),
so every release is publicly verifiable back to the exact repository state and
CI run that built it.

| Package | What it is |
| --- | --- |
| [`@routeplane/sdk`](packages/sdk) | TypeScript SDK — drop-in OpenAI client + zero-dependency core client |
| [`@routeplane/cli`](packages/cli) | `rp` command-line interface |
| [`@routeplane/mcp-server`](packages/mcp-server) | Model Context Protocol server — 40 gateway operations as tools |

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

### Agentic security

Wrap every agent tool call in the gateway's default-deny policy boundary. A refusal is a
verdict rather than a thrown error, so authorization reads as a branch, not a `try`/`catch`:

```ts
const verdict = await rp.mcp.authorizeToolCall({
  agentId: 'support-bot',
  server: 'github',
  tool: 'create_issue',
  arguments: { repo: 'acme/api', title: 'Flaky test' },
});
if (verdict.outcome === 'deny') throw new Error(verdict.reason);

// ... make the tool call, then screen the result before the model sees it:
const inspection = await rp.mcp.inspectToolResult(result);
```

`rp.mcp` covers the whole surface: the two enforcement points (`authorizeToolCall`,
`inspectToolResult`), run governance (`runStep`, `listRuns`), sampling defense
(`evaluateSampling`), the human-in-the-loop queue (`listPendingHitl`, `hitlStatus`,
`approveHitl`, `denyHitl`), signed action receipts (`issueReceipt`, `verifyReceipt`), the
anomaly operator surface (`anomalyStatus`, `clearAnomaly`), and the enforcement-event feed
(`securityEvents`).

Reading a verdict is **fail-closed**: only an explicit allow is an allow. An empty body, an
unknown `outcome`, or a proxy's error page all read as a deny, so a response the client
cannot parse can never fall through as permission granted. (A 4xx carrying no verdict at
all still throws — that is a malformed request, and turning your own bug into a policy deny
would hide it.)

All of it is gated on the tenant's `AgenticSecurity` entitlement. The gateway hides the
surface rather than refusing it, so an un-entitled key gets `RouteplaneError` with status
**404** — not a 403.

The same surfaces are available from the CLI (`rp agents runs | events | pending | approve
| deny`) and as MCP-server tools.

### Evals in CI

`rp eval` scores your outputs against a suite file and fails the build when quality drops. It
is **deterministic** — no model is called, so a run costs nothing per case and scores
identically every time. A gate that is itself non-deterministic is not a gate.

```bash
rp eval run eval-suite.json
```

```
EVALUATOR                  N  PASSED  SKIPPED  MEAN   THRESHOLD  GATE
valid_json                 3  3                1.000             —
canonical_json_match       2  1       1        0.500  0.950      FAIL
trajectory_superset_match  1  1       2        1.000  1.000      PASS
```

Exit codes are the point: **0** all thresholds met, **1** a threshold was missed, **2** the
suite file or the request was rejected. A build gate has to tell "quality dropped" from "the
config is wrong" — collapsing both into one code trains people to ignore the signal.

Two behaviours worth knowing:

- **A missing input is a skip, not a failure.** A case with no `reference` cannot be
  exact-matched; it is reported as skipped and excluded from the means. Counting it as 0
  would blend "we did not check this" into "this was wrong" and read as a regression that
  never happened.
- **An evaluator with no threshold is reported but never fails the run.** Reporting and
  gating are separate decisions; conflating them makes people delete checks instead of
  fixing them.

`trajectory_match` compares the tool calls an agent made against a reference run — message
content is never compared, so a reworded explanation is the same trajectory. `superset` is
the one that catches a *dropped* step:

```json
{
  "type": "trajectory_match",
  "match_mode": "superset",
  "overrides": { "issue_refund": { "type": "on_keys", "paths": ["order_id"] } }
}
```

The per-tool `on_keys` override is what makes this usable on a real agent: pin the order id,
ignore the timestamp that changes every run.

`rp eval rubrics` lists the built-in judge rubrics. Those are scored by an operator-armed
evaluation run on the gateway, not by `rp eval`.

From the SDK:

```ts
const report = await client.evaluations.score(cases, [{ type: 'valid_json' }]);
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
| [`agentic-security.ts`](examples/agentic-security.ts) | Guarding an agent loop — tool-call authorization, result inspection, run breakers, receipts |
| [`eval-suite.json`](examples/eval-suite.json) | A `rp eval` suite — JSON/text checks, a trajectory comparison, and gate thresholds |

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
