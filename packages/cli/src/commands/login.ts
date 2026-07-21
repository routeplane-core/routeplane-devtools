/**
 * `rp login` — authenticate with the Control Plane via the OAuth 2.0 device-code
 * flow against Entra ID, then cache the tokens (and the CP/Entra config used) on
 * the active profile so `rp keys` / `rp tenants` can call the admin API.
 */

import { saveProfile } from '../config.js';
import {
  deviceCodeLogin,
  resolveCpSettings,
  usernameFromTokens,
  type CpOverrides,
} from '../cp-auth.js';
import { green, cyan, dim } from '../output.js';

export interface LoginOptions {
  cpUrl?: string;
  cpTenantId?: string;
  cpClientId?: string;
  scope?: string;
}

export async function runLogin(profileName: string, opts: LoginOptions): Promise<void> {
  const overrides: CpOverrides = {
    cpUrl: opts.cpUrl,
    entraTenantId: opts.cpTenantId,
    clientId: opts.cpClientId,
    scope: opts.scope,
  };
  const settings = resolveCpSettings(profileName, overrides);

  const tokens = await deviceCodeLogin(settings);

  // Persist the tokens plus the CP/Entra config actually used, so subsequent
  // commands (and the silent refresh) resolve the same endpoint without flags.
  const patch: Parameters<typeof saveProfile>[1] = {
    cp_url: settings.cpUrl,
    cp_access_token: tokens.access_token,
    cp_token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
  };
  if (tokens.refresh_token) patch.cp_refresh_token = tokens.refresh_token;
  if (settings.entraTenantId) patch.cp_tenant_id = settings.entraTenantId;
  if (settings.clientId) patch.cp_client_id = settings.clientId;
  saveProfile(settings.profileName, patch);

  const who = usernameFromTokens(tokens);
  process.stdout.write(`${green('✓')} Logged in as ${cyan(who)}\n`);
  process.stdout.write(dim(`  Control Plane: ${settings.cpUrl} (profile ${settings.profileName})\n`));
}
