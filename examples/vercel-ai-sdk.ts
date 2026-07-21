// Vercel AI SDK integration. The `createHeaders` builder returns a plain header
// map, so it drops straight into the `@ai-sdk/openai` provider's `headers`
// option — every request routed through it carries your gateway steering.
//
//   npm i @routeplane/sdk @ai-sdk/openai ai
//   npx tsx examples/vercel-ai-sdk.ts

import { createOpenAI } from '@ai-sdk/openai';
import { generateText } from 'ai';
import { createHeaders } from '@routeplane/sdk/core';

const rp = createOpenAI({
  apiKey: 'rp_live_...',
  baseURL: 'https://api.routeplane.ai/v1',
  headers: createHeaders({ provider: 'anthropic', strategy: 'cost' }),
});

const { text } = await generateText({
  model: rp('gpt-4o'),
  prompt: 'What is data residency?',
});

console.log(text);
