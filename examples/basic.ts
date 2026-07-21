// Minimal usage: the `Routeplane` client is a drop-in subclass of the official
// `openai` SDK, so `chat.completions.create` works exactly as you expect.
//
//   npm i @routeplane/sdk openai
//   npx tsx examples/basic.ts

import { Routeplane } from '@routeplane/sdk';

const rp = new Routeplane({ apiKey: 'rp_live_...' });

// Buffered completion
const resp = await rp.chat.completions.create({
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'What is DPDP?' }],
});

console.log(resp.choices[0]?.message.content);
