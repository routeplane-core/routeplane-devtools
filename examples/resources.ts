// The non-OpenAI gateway surfaces — status, logs, FinOps, prompt management, and
// cache — via the zero-dependency `RouteplaneCoreClient`. No `openai` peer
// dependency required.
//
//   npm i @routeplane/sdk
//   npx tsx examples/resources.ts

import { RouteplaneCoreClient } from '@routeplane/sdk/core';

const core = new RouteplaneCoreClient({ apiKey: 'rp_live_...' });

// Check gateway health
const status = await core.status.get();
console.log('Gateway:', status);

// View recent logs
const logs = await core.logs.list({ limit: 10 });
console.log('Recent requests:', logs.length);

// FinOps usage
const usage = await core.finops.usage();
console.log('Usage:', usage);

// Prompt management
const rendered = await core.prompts.render('welcome-v2', { name: 'Rohit' });
console.log('Rendered:', rendered);

// Purge cache
await core.cache.purge();
console.log('Cache purged');
