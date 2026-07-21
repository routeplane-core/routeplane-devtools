/**
 * `rp keys …` — virtual-key administration via the Control Plane
 * (`/api/v1/tenants/{tid}/keys…`). A key's full `rp_` value is shown exactly
 * once, on create and rotate — the CP never returns it again.
 */

import { createInterface } from 'node:readline';
import { cpFetch, resolveCpSettings } from '../cp-auth.js';
import type { OutputFormat } from '../resolve.js';
import { bold, cyan, dim, green, printJson, printKeyValues, printTable, red } from '../output.js';

/** A key as listed by the CP: prefix + status only, never the secret value. */
interface KeyView {
  id: string;
  tenant_id: string;
  name: string;
  key_prefix: string;
  status: string;
  created_at: string;
  expires_at?: string | null;
  grace_until?: string | null;
}

/** The one-time create/rotate response — the only place the full key appears. */
interface CreateKeyResponse {
  id: string;
  tenant_id: string;
  name: string;
  key: string;
  key_prefix: string;
  status: string;
  created_at: string;
  expires_at?: string | null;
}

/** Resolve the target tenant: `--tenant-id` flag, else the profile default. */
function requireTenantId(profileName: string, flag?: string): string {
  const tenantId = flag ?? resolveCpSettings(profileName).defaultTenantId;
  if (!tenantId) {
    throw new Error(
      'no tenant id — pass --tenant-id or set default_tenant_id in ~/.routeplane/config.json',
    );
  }
  return tenantId;
}

/** Print a freshly-minted key with a save-it-now warning (create + rotate). */
function printNewKey(created: CreateKeyResponse): void {
  process.stdout.write(`${green('✓')} ${bold('Key created')} — ${red('save it now, it will not be shown again')}\n\n`);
  printKeyValues([
    ['Key ID', created.id],
    ['Name', created.name],
    ['Key', cyan(created.key)],
    ['Created', created.created_at],
  ]);
}

export async function runKeysList(
  profileName: string,
  output: OutputFormat,
  tenantIdFlag?: string,
): Promise<void> {
  const tenantId = requireTenantId(profileName, tenantIdFlag);
  const keys = await cpFetch<KeyView[]>(`/api/v1/tenants/${tenantId}/keys`, profileName);

  if (output === 'json') {
    printJson(keys);
    return;
  }
  if (keys.length === 0) {
    process.stdout.write('No keys found.\n');
    return;
  }
  const rows = keys.map((k) => [k.id, k.key_prefix, k.status, k.created_at ?? '']);
  printTable(['KEY ID', 'PREFIX', 'STATUS', 'CREATED'], rows);
}

export async function runKeysCreate(
  profileName: string,
  output: OutputFormat,
  tenantIdFlag: string | undefined,
  name?: string,
): Promise<void> {
  const tenantId = requireTenantId(profileName, tenantIdFlag);
  const body = { name: name ?? 'cli-generated' };
  const created = await cpFetch<CreateKeyResponse>(`/api/v1/tenants/${tenantId}/keys`, profileName, {
    method: 'POST',
    body,
  });

  if (output === 'json') {
    printJson(created);
    return;
  }
  printNewKey(created);
}

export async function runKeysRotate(
  profileName: string,
  output: OutputFormat,
  tenantIdFlag: string | undefined,
  keyId: string,
): Promise<void> {
  const tenantId = requireTenantId(profileName, tenantIdFlag);
  const created = await cpFetch<CreateKeyResponse>(
    `/api/v1/tenants/${tenantId}/keys/${keyId}/rotate`,
    profileName,
    { method: 'POST' },
  );

  if (output === 'json') {
    printJson(created);
    return;
  }
  printNewKey(created);
  process.stdout.write(
    `\n${dim('The rotated key stays valid for a 30-day grace period, then stops working.')}\n`,
  );
}

/** Prompt `question` and resolve to true only on an explicit y/yes answer. */
async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = await new Promise<string>((resolve) => rl.question(question, resolve));
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

export async function runKeysRevoke(
  profileName: string,
  output: OutputFormat,
  tenantIdFlag: string | undefined,
  keyId: string,
  force: boolean,
): Promise<void> {
  const tenantId = requireTenantId(profileName, tenantIdFlag);

  if (!force) {
    const ok = await confirm(
      `Revoke key ${cyan(keyId)} for tenant ${cyan(tenantId)} immediately? This cannot be undone. (y/N) `,
    );
    if (!ok) {
      process.stderr.write('Aborted.\n');
      return;
    }
  }

  const revoked = await cpFetch<KeyView>(`/api/v1/tenants/${tenantId}/keys/${keyId}`, profileName, {
    method: 'DELETE',
  });

  if (output === 'json') {
    printJson(revoked);
    return;
  }
  process.stdout.write(`${green('✓')} Revoked key ${revoked.id} (${revoked.status}).\n`);
}
