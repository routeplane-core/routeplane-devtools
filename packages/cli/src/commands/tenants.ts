/**
 * `rp tenants …` — tenant administration via the Control Plane
 * (`/api/v1/tenants…`). List/get are readable to any grant; create requires a
 * platform-operator token.
 */

import { cpFetch } from '../cp-auth.js';
import type { OutputFormat } from '../resolve.js';
import { green, printJson, printKeyValues, printTable } from '../output.js';

/** A tenant as returned by the CP. `lifecycle_state` is the status field. */
interface Tenant {
  id: string;
  name: string;
  tier: string;
  lifecycle_state?: string;
  overrides?: string[];
  holdbacks?: string[];
  created_at?: string;
  updated_at?: string;
}

export async function runTenantsList(profileName: string, output: OutputFormat): Promise<void> {
  const tenants = await cpFetch<Tenant[]>('/api/v1/tenants', profileName);

  if (output === 'json') {
    printJson(tenants);
    return;
  }
  if (tenants.length === 0) {
    process.stdout.write('No tenants found.\n');
    return;
  }
  const rows = tenants.map((t) => [t.id, t.name, t.tier, t.lifecycle_state ?? '']);
  printTable(['TENANT ID', 'NAME', 'TIER', 'STATUS'], rows);
}

export async function runTenantsGet(
  profileName: string,
  output: OutputFormat,
  tenantId: string,
): Promise<void> {
  const tenant = await cpFetch<Tenant>(`/api/v1/tenants/${tenantId}`, profileName);

  if (output === 'json') {
    printJson(tenant);
    return;
  }
  const pairs: [string, string][] = [
    ['Tenant ID', tenant.id],
    ['Name', tenant.name],
    ['Tier', tenant.tier],
  ];
  if (tenant.lifecycle_state) pairs.push(['Status', tenant.lifecycle_state]);
  if (tenant.overrides && tenant.overrides.length > 0) pairs.push(['Overrides', tenant.overrides.join(', ')]);
  if (tenant.holdbacks && tenant.holdbacks.length > 0) pairs.push(['Holdbacks', tenant.holdbacks.join(', ')]);
  if (tenant.created_at) pairs.push(['Created', tenant.created_at]);
  printKeyValues(pairs);
}

export interface TenantCreateOptions {
  name: string;
  tier?: string;
}

export async function runTenantsCreate(
  profileName: string,
  output: OutputFormat,
  opts: TenantCreateOptions,
): Promise<void> {
  const body: Record<string, unknown> = { name: opts.name };
  if (opts.tier !== undefined) body.tier = opts.tier;
  const tenant = await cpFetch<Tenant>('/api/v1/tenants', profileName, { method: 'POST', body });

  if (output === 'json') {
    printJson(tenant);
    return;
  }
  process.stdout.write(`${green('✓')} Created tenant ${tenant.id} (${tenant.name}, tier ${tenant.tier}).\n`);
}
