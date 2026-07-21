/**
 * Control Plane authentication — the OAuth 2.0 Device Authorization Grant
 * (RFC 8628) against Entra ID, plus the authenticated fetch helper the admin
 * commands (`login`, `keys`, `tenants`) use to reach the CP `/api/v1/*` surface.
 *
 * The Control Plane is a separate binary from the gateway with its own auth:
 * Entra ID OIDC bearer tokens, not `rp_` virtual keys. Tokens are cached in the
 * profile (`~/.routeplane/config.json`) and refreshed silently before each call.
 *
 * Native `fetch` only — no Azure SDK. The Entra endpoints are standard OAuth 2.0.
 */

import { readConfig, resolveProfileName, saveProfile, type Profile } from './config.js';
import { dim } from './output.js';

/** Default Control Plane admin API base URL. */
export const DEFAULT_CP_URL = 'https://cp.routeplane.ai';

const AUTHORITY = 'https://login.microsoftonline.com';
const DEVICE_CODE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';
/** Renew the access token this many ms before its stated expiry. */
const EXPIRY_SKEW_MS = 60_000;

/** The Entra + CP settings needed to authenticate, resolved flag > env > profile > default. */
export interface CpSettings {
  /** Config key of the profile tokens are read from / written to. */
  profileName: string;
  /** Control Plane admin API base URL. */
  cpUrl: string;
  /** Entra directory (tenant) id for the OAuth authority. */
  entraTenantId?: string;
  /** Entra application (client) id the CLI authenticates as. */
  clientId?: string;
  /** OAuth scope string requested for the device-code / refresh grants. */
  scope?: string;
  /** Business tenant (`tid_...`) default for CP commands. */
  defaultTenantId?: string;
}

/** Per-command overrides that steer CP resolution (from `rp login` flags). */
export interface CpOverrides {
  cpUrl?: string;
  entraTenantId?: string;
  clientId?: string;
  scope?: string;
}

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval: number;
  message?: string;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expires_in: number;
  token_type: string;
}

interface TokenErrorResponse {
  error: string;
  error_description?: string;
}

/** Tokens as persisted onto a profile after a successful grant. */
export interface StoredTokens {
  cp_access_token: string;
  cp_refresh_token?: string;
  cp_token_expires_at: string;
}

export class CpAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CpAuthError';
  }
}

/** Error for non-2xx CP API responses; carries the HTTP status and parsed body. */
export class CpApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = 'CpApiError';
    this.status = status;
    this.body = body;
  }
}

function trimSlashes(url: string): string {
  return url.replace(/\/+$/, '');
}

/**
 * Resolve CP/Entra settings for `profileName`, applying overrides then env then
 * the stored profile then the built-in default (for `cpUrl`/`scope` only).
 */
export function resolveCpSettings(profileName: string, overrides: CpOverrides = {}): CpSettings {
  const config = readConfig();
  const resolvedName = config ? resolveProfileName(config, profileName) : profileName;
  const profile: Profile | undefined = config?.profiles[resolvedName];

  const clientId =
    overrides.clientId ?? process.env.ROUTEPLANE_CP_CLIENT_ID ?? profile?.cp_client_id;

  const scope =
    overrides.scope ??
    process.env.ROUTEPLANE_CP_SCOPE ??
    (clientId ? `${clientId}/.default offline_access openid profile` : undefined);

  return {
    profileName: resolvedName,
    cpUrl: trimSlashes(
      overrides.cpUrl ?? process.env.ROUTEPLANE_CP_URL ?? profile?.cp_url ?? DEFAULT_CP_URL,
    ),
    entraTenantId:
      overrides.entraTenantId ?? process.env.ROUTEPLANE_CP_TENANT_ID ?? profile?.cp_tenant_id,
    clientId,
    scope,
    defaultTenantId: profile?.default_tenant_id,
  };
}

/** Decode a JWT payload without verification (display-only — it's our just-issued token). */
function decodeJwtClaims(token: string): Record<string, unknown> {
  const parts = token.split('.');
  if (parts.length < 2) return {};
  try {
    const json = Buffer.from(parts[1] ?? '', 'base64url').toString('utf8');
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Best-effort human identity from a token pair, for the "Logged in as …" line. */
export function usernameFromTokens(tokens: TokenResponse): string {
  const claims = decodeJwtClaims(tokens.id_token ?? tokens.access_token);
  for (const key of ['preferred_username', 'upn', 'email', 'unique_name', 'name', 'sub']) {
    const value = claims[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return 'unknown';
}

function toStoredTokens(tokens: TokenResponse): StoredTokens {
  const stored: StoredTokens = {
    cp_access_token: tokens.access_token,
    cp_token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
  };
  if (tokens.refresh_token) stored.cp_refresh_token = tokens.refresh_token;
  return stored;
}

function requireOAuthConfig(settings: CpSettings): { tenantId: string; clientId: string; scope: string } {
  if (!settings.entraTenantId) {
    throw new CpAuthError(
      'no Entra tenant id — set ROUTEPLANE_CP_TENANT_ID or add cp_tenant_id to the profile',
    );
  }
  if (!settings.clientId) {
    throw new CpAuthError(
      'no Entra client id — set ROUTEPLANE_CP_CLIENT_ID or add cp_client_id to the profile',
    );
  }
  return {
    tenantId: settings.entraTenantId,
    clientId: settings.clientId,
    scope: settings.scope ?? `${settings.clientId}/.default offline_access openid profile`,
  };
}

async function parseJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run the device-code flow to completion: request a code, print the sign-in
 * instructions, then poll the token endpoint until the user authorizes (or the
 * code expires / is denied). Returns the token response on success.
 */
export async function deviceCodeLogin(settings: CpSettings): Promise<TokenResponse> {
  const { tenantId, clientId, scope } = requireOAuthConfig(settings);
  const base = `${AUTHORITY}/${tenantId}/oauth2/v2.0`;

  const startResponse = await fetch(`${base}/devicecode`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, scope }).toString(),
  });
  const startBody = await parseJson(startResponse);
  if (!startResponse.ok) {
    const err = startBody as Partial<TokenErrorResponse>;
    throw new CpAuthError(
      `device authorization failed: ${err?.error_description ?? err?.error ?? startResponse.status}`,
    );
  }
  const device = startBody as DeviceCodeResponse;

  if (device.message) {
    process.stderr.write(`${device.message}\n`);
  } else {
    process.stderr.write(
      `To sign in, open ${device.verification_uri} and enter code ${device.user_code}\n`,
    );
  }
  process.stderr.write(dim('Waiting for authorization…\n'));

  const deadline = Date.now() + device.expires_in * 1000;
  let intervalMs = Math.max(device.interval, 1) * 1000;

  while (Date.now() < deadline) {
    await sleep(intervalMs);
    const tokenResponse = await fetch(`${base}/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: DEVICE_CODE_GRANT,
        client_id: clientId,
        device_code: device.device_code,
      }).toString(),
    });
    const tokenBody = await parseJson(tokenResponse);
    if (tokenResponse.ok) return tokenBody as TokenResponse;

    const err = tokenBody as Partial<TokenErrorResponse>;
    switch (err?.error) {
      case 'authorization_pending':
        break;
      case 'slow_down':
        intervalMs += 5_000;
        break;
      case 'expired_token':
        throw new CpAuthError('the device code expired before sign-in completed — run `rp login` again');
      case 'authorization_declined':
      case 'access_denied':
        throw new CpAuthError('sign-in was declined');
      default:
        throw new CpAuthError(`sign-in failed: ${err?.error_description ?? err?.error ?? 'unknown error'}`);
    }
  }
  throw new CpAuthError('the device code expired before sign-in completed — run `rp login` again');
}

/** Exchange the profile's refresh token for a fresh access token; persists both. */
export async function refreshAccessToken(settings: CpSettings, refreshToken: string): Promise<TokenResponse> {
  const { tenantId, clientId, scope } = requireOAuthConfig(settings);
  const response = await fetch(`${AUTHORITY}/${tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: clientId,
      refresh_token: refreshToken,
      scope,
    }).toString(),
  });
  const body = await parseJson(response);
  if (!response.ok) {
    const err = body as Partial<TokenErrorResponse>;
    throw new CpAuthError(
      `token refresh failed (${err?.error ?? response.status}) — run \`rp login\` to re-authenticate`,
    );
  }
  const tokens = body as TokenResponse;
  saveProfile(settings.profileName, toStoredTokens(tokens));
  return tokens;
}

/**
 * Ensure a valid CP access token exists for the profile, refreshing silently
 * when it is expired (or within the skew window). Returns the bearer token.
 * Throws `CpAuthError` when the user has never logged in.
 */
export async function ensureLoggedIn(profileName: string, overrides: CpOverrides = {}): Promise<string> {
  const settings = resolveCpSettings(profileName, overrides);
  const config = readConfig();
  const profile = config?.profiles[settings.profileName];

  if (!profile?.cp_access_token) {
    throw new CpAuthError('not logged in to the Control Plane — run `rp login` first');
  }

  const expiresAt = profile.cp_token_expires_at ? Date.parse(profile.cp_token_expires_at) : NaN;
  const expired = !Number.isFinite(expiresAt) || Date.now() >= expiresAt - EXPIRY_SKEW_MS;

  if (expired) {
    if (!profile.cp_refresh_token) {
      throw new CpAuthError('Control Plane session expired — run `rp login` to re-authenticate');
    }
    const tokens = await refreshAccessToken(settings, profile.cp_refresh_token);
    return tokens.access_token;
  }
  return profile.cp_access_token;
}

function extractCpErrorMessage(payload: unknown, status: number): string {
  if (payload && typeof payload === 'object') {
    const err = (payload as { error?: unknown }).error;
    if (typeof err === 'string') return err;
    if (err && typeof err === 'object' && typeof (err as { message?: unknown }).message === 'string') {
      return (err as { message: string }).message;
    }
    const message = (payload as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  if (typeof payload === 'string' && payload.length > 0) return payload;
  return `Control Plane request failed with status ${status}`;
}

export interface CpFetchOptions {
  method?: string;
  body?: unknown;
}

/**
 * Authenticated fetch to the CP `/api/v1/*` surface. Attaches the bearer token,
 * transparently refreshing it once on a 401. `path` is joined onto the resolved
 * `cpUrl` (leading slash optional). Returns the parsed JSON body.
 */
export async function cpFetch<T>(
  path: string,
  profileName: string,
  opts: CpFetchOptions = {},
  overrides: CpOverrides = {},
): Promise<T> {
  const settings = resolveCpSettings(profileName, overrides);
  const relative = path.startsWith('/') ? path : `/${path}`;
  const url = `${settings.cpUrl}${relative}`;
  const hasBody = opts.body !== undefined;

  const send = async (token: string): Promise<Response> =>
    fetch(url, {
      method: opts.method ?? 'GET',
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/json',
        ...(hasBody ? { 'content-type': 'application/json' } : {}),
      },
      body: hasBody ? JSON.stringify(opts.body) : undefined,
    });

  let token = await ensureLoggedIn(profileName, overrides);
  let response = await send(token);

  // One retry on 401: the cached token may have been revoked before its stated
  // expiry. Force a refresh and try again before surfacing the failure.
  if (response.status === 401) {
    const config = readConfig();
    const refresh = config?.profiles[settings.profileName]?.cp_refresh_token;
    if (refresh) {
      const tokens = await refreshAccessToken(settings, refresh);
      token = tokens.access_token;
      response = await send(token);
    }
  }

  const payload = await parseJson(response);
  if (!response.ok) {
    throw new CpApiError(extractCpErrorMessage(payload, response.status), response.status, payload);
  }
  return payload as T;
}
