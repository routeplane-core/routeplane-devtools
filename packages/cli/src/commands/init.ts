/**
 * `rp init` — interactive first-run setup.
 *
 * Prompts for a gateway URL, an API key, and a profile name, then writes them
 * into `~/.routeplane/config.json`, making the new profile the default.
 */

import { createInterface } from 'node:readline';
import {
  DEFAULT_BASE_URL,
  readConfig,
  writeConfig,
  configPath,
  type Config,
} from '../config.js';
import { bold, cyan, dim, green } from '../output.js';

export async function runInit(): Promise<void> {
  // Consume prompts via the readline async iterator rather than a `question()`
  // promise chain: on piped (non-TTY) stdin every line can be emitted before the
  // next callback registers, which drops answers. The iterator buffers lines, so
  // it is correct for both interactive and piped input.
  const rl = createInterface({ input: process.stdin });
  const lines = rl[Symbol.asyncIterator]();
  const ask = async (question: string): Promise<string> => {
    process.stdout.write(question);
    const next = await lines.next();
    return next.done ? '' : next.value.trim();
  };

  try {
    process.stdout.write(`${bold('Welcome to Routeplane!')}\n`);

    const baseUrl = (await ask(`Gateway URL ${dim(`[${DEFAULT_BASE_URL}]`)}: `)) || DEFAULT_BASE_URL;
    const apiKey = await ask('API Key: ');
    if (!apiKey) {
      throw new Error('an API key is required');
    }
    const profileName = (await ask(`Profile name ${dim('[cloud]')}: `)) || 'cloud';

    const existing: Config = readConfig() ?? { default: profileName, profiles: {} };
    writeConfig({
      default: profileName,
      profiles: {
        ...existing.profiles,
        [profileName]: { base_url: baseUrl, api_key: apiKey },
      },
    });

    process.stdout.write(
      `${green('✓')} Saved profile ${cyan(profileName)} to ${dim(configPath())}\n`,
    );
  } finally {
    rl.close();
  }
}
