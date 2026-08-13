import { execFile } from 'node:child_process';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { promisify } from 'node:util';
import { describe, expect, it, vi } from 'vitest';
import {
  ACTIVATION_RECEIPTS_URL,
  AdoptionVerificationError,
  buildActivationReceiptPayload,
  runAdoptVerify,
  validateLoopbackBaseUrl,
} from './adopt.js';
import { CLI_VERSION } from '../version.js';

const execFileAsync = promisify(execFile);
const CHALLENGE = `rpact_550e8400-e29b-41d4-a716-446655440000.${'a'.repeat(43)}`;
const VERIFIED_AT = '2026-08-13T01:02:03.000Z';
const MEANING = 'This receipt means only that this CLI observed one successful local health response and you opted to report it. It does not prove installation ownership, organization uniqueness, production use, compliance, or audit integrity.';

function acknowledgement() {
  return {
    receipt_id: '550e8400-e29b-41d4-a716-446655440001',
    accepted_at: '2026-08-13T01:02:04.000Z',
    schema_version: '1',
    privacy_policy_version: '2026-08-13',
    verified_at: VERIFIED_AT,
    cli_version: CLI_VERSION,
    request: { ok: true, http_status: 200 },
    meaning: MEANING,
  };
}

function jsonResponse(value: unknown, status = 202): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}

function captureOutput(): { chunks: string[]; write: (text: string) => void } {
  const chunks: string[] = [];
  return { chunks, write: (text: string) => void chunks.push(text) };
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

describe('validateLoopbackBaseUrl', () => {
  it.each([
    ['http://localhost:8787', 'http://localhost:8787'],
    ['http://127.0.0.1:8080/', 'http://127.0.0.1:8080'],
    ['http://127.18.200.254/gateway/', 'http://127.18.200.254/gateway'],
    ['http://[::1]:9443/gateway/', 'http://[::1]:9443/gateway'],
  ])('accepts canonical loopback URL %s', (input, expected) => {
    expect(validateLoopbackBaseUrl(input)).toBe(expected);
  });

  it.each([
    'https://localhost', 'http://example.com', 'http://localhost.example.com', 'http://128.0.0.1',
    'http://[::2]', 'ftp://localhost', 'http://user@localhost', 'http://localhost?x=1',
    'http://localhost#x', 'http://localhost.', 'http://2130706433', 'http://0x7f000001',
    'http://127.1', 'http://127.001.0.1', 'http://localhost:99999', ' http://localhost',
  ])('rejects noncanonical or non-loopback URL %s', (input) => {
    expect(() => validateLoopbackBaseUrl(input)).toThrow(AdoptionVerificationError);
  });
});

describe('activation receipt payload', () => {
  it('contains exactly the string-versioned allowlist', () => {
    const payload = buildActivationReceiptPayload(CHALLENGE, new Date(VERIFIED_AT));
    expect(payload).toEqual({
      schema_version: '1', challenge: CHALLENGE, verified_at: VERIFIED_AT,
      cli_version: CLI_VERSION, request: { ok: true, http_status: 200 },
    });
    expect(Object.keys(payload)).toEqual(['schema_version', 'challenge', 'verified_at', 'cli_version', 'request']);
  });

  it.each(['challenge', 'rpact_bad', `${CHALLENGE}x`, `${CHALLENGE}\n`])('rejects malformed challenge %s', (value) => {
    expect(() => buildActivationReceiptPayload(value, new Date())).toThrow('valid Routeplane activation token');
  });
});

describe('runAdoptVerify', () => {
  it('requires --yes before network I/O in non-interactive mode', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    await expect(runAdoptVerify({ challenge: CHALLENGE, baseUrl: 'http://localhost:8787', yes: false }, { fetch: fetchMock, isInteractive: () => false })).rejects.toThrow('requires --yes');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a malformed challenge before local I/O', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    await expect(runAdoptVerify({ challenge: 'bad', baseUrl: 'http://127.0.0.1:8787', yes: true }, { fetch: fetchMock })).rejects.toThrow('valid Routeplane activation token');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects localhost when any resolved address is not loopback', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    await expect(runAdoptVerify({ challenge: CHALLENGE, baseUrl: 'http://localhost:8787', yes: true }, { fetch: fetchMock, resolveLocalhost: async () => ['127.0.0.1', '10.0.0.1'] })).rejects.toThrow('resolve exclusively');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses exactly one unauthenticated GET and defaults to no', async () => {
    const output = captureOutput();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('ok', { status: 200 }));
    await runAdoptVerify(
      { challenge: CHALLENGE, baseUrl: 'http://localhost:8787', yes: false },
      { fetch: fetchMock, resolveLocalhost: async () => ['::1', '127.0.0.1'], isInteractive: () => true, confirm: async () => false, now: () => new Date(VERIFIED_AT), writeOutput: output.write },
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:8787/healthz');
    expect(init).toMatchObject({ method: 'GET', redirect: 'error' });
    expect(init.body).toBeUndefined();
    expect(init.headers).toBeUndefined();
    const visible = output.chunks.join('');
    expect(visible.indexOf(ACTIVATION_RECEIPTS_URL)).toBeLessThan(visible.indexOf('"schema_version"'));
    expect(visible).toContain('Activation receipt not submitted.');
  });

  it.each([201, 204, 301, 400, 500])('requires exact local HTTP 200, not %s', async (status) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(null, { status }));
    await expect(runAdoptVerify({ challenge: CHALLENGE, baseUrl: 'http://127.1.2.3', yes: true }, { fetch: fetchMock })).rejects.toThrow('was not HTTP 200');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('submits the exact minimal payload and validates the canonical acknowledgement', async () => {
    const output = captureOutput();
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('healthy', { status: 200 }))
      .mockResolvedValueOnce(jsonResponse(acknowledgement()));
    await runAdoptVerify(
      { challenge: CHALLENGE, baseUrl: 'http://127.0.0.1:8787', yes: true },
      { fetch: fetchMock, now: () => new Date(VERIFIED_AT), writeOutput: output.write },
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, receiptInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(receiptInit).toMatchObject({ method: 'POST', redirect: 'error' });
    expect(JSON.parse(receiptInit.body as string)).toEqual({
      schema_version: '1', challenge: CHALLENGE, verified_at: VERIFIED_AT,
      cli_version: CLI_VERSION, request: { ok: true, http_status: 200 },
    });
    const visible = output.chunks.join('');
    expect(visible).toContain(acknowledgement().receipt_id);
    expect(visible).toContain('does not prove installation ownership');
    expect(visible).not.toContain('127.0.0.1');
  });

  it('rejects extra fields in the acknowledgement', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(jsonResponse({ ...acknowledgement(), hostname: 'private' }));
    await expect(runAdoptVerify({ challenge: CHALLENGE, baseUrl: 'http://127.0.0.1', yes: true }, { fetch: fetchMock, now: () => new Date(VERIFIED_AT), writeOutput: () => undefined })).rejects.toThrow('response was invalid');
  });
});

describe('local HTTP integration', () => {
  it('performs one local health request before one receipt request', async () => {
    const calls: Array<{ path: string; method?: string; headers: IncomingMessage['headers']; body: string }> = [];
    const server = createServer(async (request, response) => {
      calls.push({ path: request.url ?? '', method: request.method, headers: request.headers, body: await readBody(request) });
      if (request.url === '/healthz') { response.writeHead(200); response.end('ok'); return; }
      response.writeHead(202, { 'content-type': 'application/json' }); response.end(JSON.stringify(acknowledgement()));
    });
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    try {
      const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      await runAdoptVerify({ challenge: CHALLENGE, baseUrl: origin, yes: true }, { activationReceiptsUrl: `${origin}/v1/activation-receipts`, now: () => new Date(VERIFIED_AT), writeOutput: () => undefined });
      expect(calls.map(({ path, method }) => [path, method])).toEqual([['/healthz', 'GET'], ['/v1/activation-receipts', 'POST']]);
      expect(calls[0].body).toBe('');
      expect(calls[0].headers['x-routeplane-api-key']).toBeUndefined();
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});

describe('CLI wiring', () => {
  it('displays package version and required command-local options', async () => {
    const cli = new URL('../../dist/index.js', import.meta.url);
    expect((await execFileAsync(process.execPath, [cli.pathname, '--version'])).stdout.trim()).toBe(CLI_VERSION);
    const { stdout } = await execFileAsync(process.execPath, [cli.pathname, 'adopt', 'verify', '--help']);
    expect(stdout).toContain('--challenge <token>');
    expect(stdout).toContain('--base-url <url>');
  });
});
