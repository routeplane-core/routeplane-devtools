/**
 * Profile config manager for `~/.routeplane/config.json`.
 *
 * A config holds named connection profiles and the name of the default one:
 *
 * ```json
 * {
 *   "default": "cloud",
 *   "profiles": {
 *     "cloud": { "base_url": "https://api.routeplane.ai", "api_key": "rp_live_..." }
 *   }
 * }
 * ```
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

export interface Profile {
  base_url: string;
  api_key: string;
}

export interface Config {
  default: string;
  profiles: Record<string, Profile>;
}

export const DEFAULT_BASE_URL = 'https://api.routeplane.ai';

export function configDir(): string {
  return join(homedir(), '.routeplane');
}

export function configPath(): string {
  return join(configDir(), 'config.json');
}

/** Read the config file, or `null` when it does not exist yet. */
export function readConfig(): Config | null {
  let text: string;
  try {
    text = readFileSync(configPath(), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  const parsed = JSON.parse(text) as Partial<Config>;
  return {
    default: typeof parsed.default === 'string' ? parsed.default : 'default',
    profiles: parsed.profiles ?? {},
  };
}

/** Write the config file, creating `~/.routeplane` and restricting it to the owner. */
export function writeConfig(config: Config): void {
  mkdirSync(configDir(), { recursive: true, mode: 0o700 });
  writeFileSync(configPath(), `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}

/**
 * Resolve a profile by name, honouring the config's `default` pointer when the
 * requested name is `"default"`. Returns `null` when no such profile exists.
 */
export function getProfile(config: Config, name: string): Profile | null {
  const resolvedName = name === 'default' ? config.default : name;
  return config.profiles[resolvedName] ?? null;
}
