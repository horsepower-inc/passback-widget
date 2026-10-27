import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runConnectWebhook } from './connect-webhook';
import { writeCredentials } from './credentials';
import type { HostedDeps } from './hosted';

const API = 'https://api.example.test';
const URL_IN = 'https://hooks.test/in';
const SECRET = 'whsec_signing_secret_value';
type Recorded = { method: string; url: string; body?: string };
type Reply = { status: number; body?: unknown };

describe('connect webhook', () => {
  let dir: string;
  let requests: Recorded[];
  let outLines: string[];
  let errLines: string[];
  let replies: Reply[];

  function deps(): HostedDeps {
    return {
      credentialsPath: path.join(dir, 'credentials.json'),
      out: (line) => outLines.push(line),
      err: (line) => errLines.push(line),
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        requests.push({
          method: init?.method ?? 'GET',
          url: String(input),
          body: init?.body as string | undefined,
        });
        const reply = replies.shift() ?? { status: 404 };
        return new Response(JSON.stringify(reply.body), { status: reply.status });
      }) as typeof fetch,
    };
  }
  const opts = (json = false) => ({ root: path.join(dir, 'shop'), url: URL_IN, json });
  const sites = { status: 200, body: [{ siteId: 's1', name: 'shop', origins: [], snippet: '' }] };

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'passback-webhook-'));
    requests = [];
    outLines = [];
    errLines = [];
    replies = [sites];
    await writeCredentials(path.join(dir, 'credentials.json'), {
      v: 1,
      api: API,
      accessToken: 'pbt_token',
    });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('saves the address for the site and prints the signing secret once', async () => {
    replies.push({ status: 200, body: { signingSecret: SECRET } });
    expect(await runConnectWebhook(opts(), deps())).toBe(0);
    expect(requests[1]).toMatchObject({
      method: 'PUT',
      url: `${API}/v1/customer/sites/s1/webhook`,
      body: JSON.stringify({ url: URL_IN }),
    });
    expect(outLines).toEqual([
      'Webhook saved for shop.',
      `Signing secret (shown once, keep it now): ${SECRET}`,
      'Check each delivery with the Passback-Signature header; see https://passback.dev/docs/webhook/.',
    ]);
    expect(errLines).toEqual([]);
  });

  it('prints the secret in the json event and never the address', async () => {
    replies.push({ status: 200, body: { signingSecret: SECRET } });
    expect(await runConnectWebhook(opts(true), deps())).toBe(0);
    expect(outLines).toHaveLength(1);
    expect(JSON.parse(outLines[0]!)).toEqual({
      event: 'connected',
      site: 'shop',
      tracker: 'webhook',
      signingSecret: SECRET,
    });
    expect(outLines.join('\n')).not.toContain(URL_IN);
  });

  it('says the address was refused for a 400 and unreachable for a 502', async () => {
    replies.push({ status: 400, body: { code: 'bad_body' } });
    expect(await runConnectWebhook(opts(), deps())).toBe(1);
    expect(errLines).toEqual(['That is not an https address Passback can send to.']);
    replies = [sites, { status: 502, body: { code: 'unreachable' } }];
    errLines.length = 0;
    expect(await runConnectWebhook(opts(), deps())).toBe(1);
    expect(errLines).toEqual([
      'Passback could not send a test message to that address. Check that it answers with a 2xx status.',
    ]);
    expect(outLines).toEqual([]);
  });

  it('stops with the common failure when the person is signed out', async () => {
    await rm(path.join(dir, 'credentials.json'));
    expect(await runConnectWebhook(opts(), deps())).toBe(1);
    expect(errLines).toEqual(['Not signed in. Run npx passback login first.']);
    expect(requests).toEqual([]);
  });
});
