/**
 * Effective-connection resolution.
 *
 * Precedence, highest first:
 *   1. CLI flag        (`--base-url`, `--api-key`)
 *   2. Environment     (`ROUTEPLANE_BASE_URL`, `ROUTEPLANE_API_KEY`)
 *   3. Named profile   (`~/.routeplane/config.json`)
 *
 * `base_url` additionally falls back to the built-in default; `api_key` has no
 * default and its absence is a hard error.
 */

import { DEFAULT_BASE_URL, getProfile, readConfig } from './config.js';

export type OutputFormat = 'table' | 'json';

/** The subset of global flags that steer resolution. */
export interface GlobalFlags {
  profile?: string;
  baseUrl?: string;
  apiKey?: string;
  output?: string;
}

export interface Connection {
  baseUrl: string;
  apiKey: string;
}

export class ResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResolutionError';
  }
}

/** Normalize the `--output` flag; anything other than `json` is treated as `table`. */
export function resolveOutput(flags: GlobalFlags, jsonFlag?: boolean): OutputFormat {
  if (jsonFlag) return 'json';
  return flags.output === 'json' ? 'json' : 'table';
}

/** Resolve the base URL + API key for a gateway call, or throw `ResolutionError`. */
export function resolveConnection(flags: GlobalFlags): Connection {
  const profileName = flags.profile ?? 'default';
  const config = readConfig();
  const profile = config ? getProfile(config, profileName) : null;

  if (flags.profile && flags.profile !== 'default' && !profile) {
    throw new ResolutionError(
      `profile "${profileName}" not found in ~/.routeplane/config.json — run \`rp init\` first`,
    );
  }

  const baseUrl =
    flags.baseUrl ?? process.env.ROUTEPLANE_BASE_URL ?? profile?.base_url ?? DEFAULT_BASE_URL;

  const apiKey = flags.apiKey ?? process.env.ROUTEPLANE_API_KEY ?? profile?.api_key;

  if (!apiKey) {
    throw new ResolutionError(
      'no API key found — pass --api-key, set ROUTEPLANE_API_KEY, or run `rp init`',
    );
  }

  return { baseUrl, apiKey };
}
