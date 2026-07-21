// Streaming with gateway metadata. `createChatCompletionStream` returns the
// OpenAI chunk stream plus the decoded `x-routeplane-*` response metadata, which
// arrives on the response headers before the first chunk.
//
//   npm i @routeplane/sdk openai
//   npx tsx examples/streaming.ts

import { Routeplane } from '@routeplane/sdk';

const rp = new Routeplane({ apiKey: 'rp_live_...', provider: 'openai' });

const { stream, routeplane } = await rp.createChatCompletionStream({
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'Explain sovereign routing' }],
  stream: true,
});

for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content ?? '');
}

console.log(`\nServed by: ${routeplane.provider}`);
