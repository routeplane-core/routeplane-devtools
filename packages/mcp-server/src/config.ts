/**
 * Resolves the gateway API key and base URL for the MCP server.
 *
 * Precedence (first non-empty wins), matching the CLI:
 *   API key   — ROUTEPLANE_API_KEY env  →  --api-key arg  →  ~/.routeplane/config.json profile
 *   Base URL  — ROUTEPLANE_BASE_URL env  →  --base-url arg →  profile base_url  →  default
 *
 * The MCP config block sets ROUTEPLANE_API_KEY, so the env var is the primary
 * path; the CLI arg and shared config file are fallbacks for terminal use.
 */

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const DEFAULT_BASE_URL = 'https://api.routeplane.ai';

export interface ResolvedConfig {
  apiKey: string;
  baseUrl: string;
}

interface CliArgs {
  apiKey?: string;
  baseUrl?: string;
}

interface ProfileShape {
  api_key?: string;
  apiKey?: string;
  base_url?: string;
  baseUrl?: string;
}

interface ConfigFileShape extends ProfileShape {
  default_profile?: string;
  defaultProfile?: string;
  profiles?: Record<string, ProfileShape>;
}

/** Parse `--api-key <v>` / `--api-key=<v>` and the `--base-url` variants. */
export function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const take = (flag: string): string | undefined => {
      if (token === flag) {
        const next = argv[i + 1];
        if (next !== undefined) i += 1;
        return next;
      }
      if (token.startsWith(`${flag}=`)) return token.slice(flag.length + 1);
      return undefined;
    };
    const apiKey = take('--api-key');
    if (apiKey !== undefined) {
      args.apiKey = apiKey;
      continue;
    }
    const baseUrl = take('--base-url');
    if (baseUrl !== undefined) args.baseUrl = baseUrl;
  }
  return args;
}

function pickProfile(file: ConfigFileShape, env: NodeJS.ProcessEnv): ProfileShape {
  const name = env.ROUTEPLANE_PROFILE ?? file.default_profile ?? file.defaultProfile;
  if (name && file.profiles?.[name]) return file.profiles[name];
  if (!name && file.profiles?.default) return file.profiles.default;
  return file;
}

function readProfile(env: NodeJS.ProcessEnv): ProfileShape {
  const path = join(homedir(), '.routeplane', 'config.json');
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as ConfigFileShape;
    return pickProfile(parsed, env);
  } catch {
    // A malformed config file must not crash the server — fall back to env/args.
    return {};
  }
}

export function resolveConfig(argv: readonly string[], env: NodeJS.ProcessEnv): ResolvedConfig {
  const args = parseArgs(argv);
  const profile = readProfile(env);

  const apiKey = env.ROUTEPLANE_API_KEY ?? args.apiKey ?? profile.api_key ?? profile.apiKey;
  const baseUrl =
    env.ROUTEPLANE_BASE_URL ?? args.baseUrl ?? profile.base_url ?? profile.baseUrl ?? DEFAULT_BASE_URL;

  if (!apiKey) {
    throw new Error(
      'Routeplane API key not found. Set ROUTEPLANE_API_KEY, pass --api-key, or add one to ~/.routeplane/config.json.',
    );
  }

  return { apiKey, baseUrl };
}
