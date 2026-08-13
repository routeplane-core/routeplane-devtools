/**
 * `rp adopt verify` — observe one local Routeplane health response, then
 * optionally submit a deliberately minimal anonymous activation receipt.
 *
 * No gateway key, machine metadata, hostname, prompt, or response content is
 * read, persisted, printed, or sent to the activation service.
 */

import { lookup } from 'node:dns/promises';
import { createInterface } from 'node:readline';
import { CLI_VERSION } from '../version.js';

export const ACTIVATION_RECEIPTS_URL =
  'https://assistant.routeplane.ai/v1/activation-receipts';

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RECEIPT_RESPONSE_BYTES = 16 * 1024;
const CHALLENGE = /^rpact_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[A-Za-z0-9_-]{43}$/;
const RECEIPT_MEANING =
  'This receipt means only that this CLI observed one successful local health response and you opted to report it. It does not prove installation ownership, organization uniqueness, production use, compliance, or audit integrity.';

export interface ActivationReceiptPayload {
  schema_version: '1';
  challenge: string;
  verified_at: string;
  cli_version: string;
  request: {
    ok: true;
    http_status: 200;
  };
}

export interface ActivationReceiptAcknowledgement {
  receipt_id: string;
  accepted_at: string;
  schema_version: '1';
  privacy_policy_version: string;
  verified_at: string;
  cli_version: string;
  request: { ok: true; http_status: 200 };
  meaning: string;
}

export interface AdoptVerifyOptions {
  challenge: string;
  baseUrl: string;
  yes: boolean;
}

export interface AdoptVerifyDependencies {
  fetch?: typeof fetch;
  now?: () => Date;
  isInteractive?: () => boolean;
  confirm?: (question: string) => Promise<boolean>;
  writeOutput?: (text: string) => void;
  resolveLocalhost?: () => Promise<readonly string[]>;
  /** Test-only transport seam. The CLI exposes no receipt-endpoint option. */
  activationReceiptsUrl?: string;
}

/** A user-safe error whose message never includes a URL or response body. */
export class AdoptionVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdoptionVerificationError';
  }
}

function rawAuthority(input: string): string | null {
  const match = /^[a-z][a-z\d+.-]*:\/\/([^/?#]*)/i.exec(input);
  return match?.[1] ?? null;
}

function isCanonicalIpv4Loopback(host: string): boolean {
  const octets = host.split('.');
  if (octets.length !== 4 || octets.some((part) => !/^(?:0|[1-9]\d{0,2})$/.test(part))) return false;
  const values = octets.map(Number);
  return values[0] === 127 && values.every((value) => value >= 0 && value <= 255);
}

function isResolvedLoopback(address: string): boolean {
  return address === '::1' || isCanonicalIpv4Loopback(address);
}

/** Accept only canonical, literal HTTP loopback URLs. */
export function validateLoopbackBaseUrl(input: string): string {
  if (input.length === 0 || input !== input.trim() || input.includes('?') || input.includes('#')) {
    throw new AdoptionVerificationError(
      'base URL must be an HTTP loopback URL without credentials, query, or fragment',
    );
  }

  const authority = rawAuthority(input);
  if (authority === null || authority.includes('@')) {
    throw new AdoptionVerificationError(
      'base URL must be an HTTP loopback URL without credentials, query, or fragment',
    );
  }

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new AdoptionVerificationError(
      'base URL must be an HTTP loopback URL without credentials, query, or fragment',
    );
  }

  const rawHost = authority.replace(/:\d{1,5}$/, '');
  const allowed =
    rawHost.toLowerCase() === 'localhost' || rawHost === '[::1]' || isCanonicalIpv4Loopback(rawHost);
  if (
    !allowed ||
    url.protocol !== 'http:' ||
    url.username !== '' ||
    url.password !== '' ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    throw new AdoptionVerificationError(
      'base URL must be an HTTP loopback URL without credentials, query, or fragment',
    );
  }

  return url.href.replace(/\/+$/, '');
}

export function buildActivationReceiptPayload(
  challenge: string,
  verifiedAt: Date,
): ActivationReceiptPayload {
  if (!CHALLENGE.test(challenge)) {
    throw new AdoptionVerificationError('challenge is not a valid Routeplane activation token');
  }
  if (!Number.isFinite(verifiedAt.getTime())) {
    throw new AdoptionVerificationError('verification time is invalid');
  }
  return {
    schema_version: '1',
    challenge,
    verified_at: verifiedAt.toISOString(),
    cli_version: CLI_VERSION,
    request: { ok: true, http_status: 200 },
  };
}

async function confirmDefaultNo(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = await new Promise<string>((resolve) => rl.question(question, resolve));
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

async function defaultResolveLocalhost(): Promise<readonly string[]> {
  try {
    return (await lookup('localhost', { all: true, verbatim: true })).map(({ address }) => address);
  } catch {
    throw new AdoptionVerificationError('localhost did not resolve exclusively to loopback');
  }
}

async function verifyLocalGateway(
  fetchImpl: typeof fetch,
  baseUrl: string,
  resolveLocalhost: () => Promise<readonly string[]>,
): Promise<void> {
  if (new URL(baseUrl).hostname === 'localhost') {
    const addresses = await resolveLocalhost();
    if (addresses.length === 0 || !addresses.every(isResolvedLoopback)) {
      throw new AdoptionVerificationError('localhost did not resolve exclusively to loopback');
    }
  }

  let response: Response;
  try {
    response = await fetchImpl(`${baseUrl}/healthz`, {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new AdoptionVerificationError('local health request failed');
  }
  await response.body?.cancel();
  if (response.status !== 200) {
    throw new AdoptionVerificationError('local health response was not HTTP 200');
  }
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RECEIPT_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw new AdoptionVerificationError('activation receipt response was invalid');
  }
  if (!response.body) throw new AdoptionVerificationError('activation receipt response was invalid');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_RECEIPT_RESPONSE_BYTES) {
      await reader.cancel();
      throw new AdoptionVerificationError('activation receipt response was invalid');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new AdoptionVerificationError('activation receipt response was invalid');
  }
}

function parseAcknowledgement(
  value: unknown,
  submitted: ActivationReceiptPayload,
): ActivationReceiptAcknowledgement {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AdoptionVerificationError('activation receipt response was invalid');
  }
  const record = value as Record<string, unknown>;
  const request = record.request as Record<string, unknown> | undefined;
  const exactKeys = ['accepted_at', 'cli_version', 'meaning', 'privacy_policy_version', 'receipt_id', 'request', 'schema_version', 'verified_at'];
  if (
    JSON.stringify(Object.keys(record).sort()) !== JSON.stringify(exactKeys) ||
    typeof record.receipt_id !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(record.receipt_id) ||
    typeof record.accepted_at !== 'string' ||
    !Number.isFinite(Date.parse(record.accepted_at)) ||
    record.schema_version !== '1' ||
    typeof record.privacy_policy_version !== 'string' ||
    record.privacy_policy_version.length > 64 ||
    record.verified_at !== submitted.verified_at ||
    record.cli_version !== submitted.cli_version ||
    record.meaning !== RECEIPT_MEANING ||
    !request ||
    JSON.stringify(Object.keys(request).sort()) !== JSON.stringify(['http_status', 'ok']) ||
    request.ok !== true ||
    request.http_status !== 200
  ) {
    throw new AdoptionVerificationError('activation receipt response was invalid');
  }
  return value as ActivationReceiptAcknowledgement;
}

async function submitActivationReceipt(
  fetchImpl: typeof fetch,
  endpoint: string,
  payload: ActivationReceiptPayload,
): Promise<ActivationReceiptAcknowledgement> {
  let response: Response;
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new AdoptionVerificationError('activation receipt submission failed');
  }
  if (response.status !== 202 || !response.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    await response.body?.cancel();
    throw new AdoptionVerificationError('activation receipt submission was not accepted');
  }
  return parseAcknowledgement(await readBoundedJson(response), payload);
}

export async function runAdoptVerify(
  options: AdoptVerifyOptions,
  dependencies: AdoptVerifyDependencies = {},
): Promise<void> {
  const baseUrl = validateLoopbackBaseUrl(options.baseUrl);
  const fetchImpl = dependencies.fetch ?? fetch;
  const interactive = dependencies.isInteractive?.() ?? Boolean(process.stdin.isTTY);
  const writeOutput = dependencies.writeOutput ?? ((text: string) => process.stdout.write(text));

  if (!options.yes && !interactive) {
    throw new AdoptionVerificationError('non-interactive verification requires --yes');
  }
  buildActivationReceiptPayload(options.challenge, new Date(0));
  await verifyLocalGateway(fetchImpl, baseUrl, dependencies.resolveLocalhost ?? defaultResolveLocalhost);

  const payload = buildActivationReceiptPayload(options.challenge, (dependencies.now ?? (() => new Date()))());
  const endpoint = dependencies.activationReceiptsUrl ?? ACTIVATION_RECEIPTS_URL;
  writeOutput(`Activation receipt endpoint: ${endpoint}\nActivation receipt payload:\n${JSON.stringify(payload, null, 2)}\n`);
  if (!options.yes) {
    const confirmed = await (dependencies.confirm ?? confirmDefaultNo)('Submit this activation receipt? (y/N) ');
    if (!confirmed) {
      writeOutput('Activation receipt not submitted.\n');
      return;
    }
  }

  const receipt = await submitActivationReceipt(fetchImpl, endpoint, payload);
  writeOutput(`Activation receipt accepted: ${receipt.receipt_id}\n${RECEIPT_MEANING}\n`);
}
