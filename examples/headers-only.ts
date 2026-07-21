// Layer 1 — no Routeplane client at all. Keep your stock `openai` SDK and steer
// the gateway per request with the typed `createHeaders` builder from the
// zero-dependency `@routeplane/sdk/core` entry.
//
// Passing the `rp_` key as `apiKey` authenticates via the gateway's
// `Authorization: Bearer rp_...` fallback, so no extra auth header is needed.
//
//   npm i @routeplane/sdk openai
//   npx tsx examples/headers-only.ts

import OpenAI from 'openai';
import { createHeaders } from '@routeplane/sdk/core';

const client = new OpenAI({
  apiKey: 'rp_live_...',
  baseURL: 'https://api.routeplane.ai/v1',
});

const resp = await client.chat.completions.create(
  {
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'Hello' }],
  },
  {
    headers: createHeaders({
      provider: 'anthropic,openai', // try Anthropic, fall back to OpenAI
      residency: 'IN', // keep regulated data in-region
      strategy: 'cost', // cheapest eligible provider first
      useCase: 'support-bot', // FinOps cost attribution
    }),
  },
);

console.log(resp.choices[0]?.message.content);
