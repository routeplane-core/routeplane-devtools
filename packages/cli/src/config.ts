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
  /** Data-plane virtual key (`rp_...`). Absent on profiles that only hold CP creds. */
  api_key?: string;
  /** Control Plane admin API base URL (a distinct binary from the gateway). */
  cp_url?: string;
  /** Entra ID directory (tenant) id used for the CP OAuth device-code flow. */
  cp_tenant_id?: string;
  /** Entra ID application (client) id the CLI authenticates as. */
  cp_client_id?: string;
  /** Cached CP access token (bearer for `/api/v1/*`). */
  cp_access_token?: string;
  /** Cached CP refresh token, used to silently renew the access token. */
  cp_refresh_token?: string;
  /** ISO-8601 instant at which `cp_access_token` expires. */
  cp_token_expires_at?: string;
  /** Business tenant (`tid_...`) used when a CP command omits `--tenant-id`. */
  default_tenant_id?: string;
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
 * Resolve a profile *name*, honouring the config's `default` pointer when the
 * requested name is `"default"`. This is the key under which the profile lives
 * in `profiles`, so token writes land on the same record reads come from.
 */
export function resolveProfileName(config: Config, name: string): string {
  return name === 'default' ? config.default : name;
}

/**
 * Resolve a profile by name, honouring the config's `default` pointer when the
 * requested name is `"default"`. Returns `null` when no such profile exists.
 */
export function getProfile(config: Config, name: string): Profile | null {
  return config.profiles[resolveProfileName(config, name)] ?? null;
}

/**
 * Merge `patch` into a profile and persist the config, creating the profile (and
 * the config file) if absent. Used to write CP tokens back after login/refresh.
 * Returns the merged profile.
 */
export function saveProfile(name: string, patch: Partial<Profile>): Profile {
  const config: Config = readConfig() ?? { default: name, profiles: {} };
  const resolvedName = resolveProfileName(config, name);
  const existing: Profile = config.profiles[resolvedName] ?? { base_url: DEFAULT_BASE_URL };
  const merged: Profile = { ...existing, ...patch };
  config.profiles[resolvedName] = merged;
  // Point `default` at this profile when it dangles (fresh config or renamed away).
  if (!config.profiles[config.default]) config.default = resolvedName;
  writeConfig(config);
  return merged;
}
