import { describe, expect, it } from 'vitest';
import { guardPost, MAX_BODY_BYTES } from './route-guards';

const URL_ = 'http://localhost:3003/api/passback/mark';
const JSON_TYPE = { 'content-type': 'application/json' };

function post(headers: Record<string, string>, body?: BodyInit): Request {
  return new Request(URL_, { method: 'POST', headers, body });
}

async function refusal(request: Request) {
  const result = await guardPost(request);
  if (result.ok) throw new Error('expected a refusal');
  return result.response;
}

describe('guardPost', () => {
  it('returns the body of a same-origin JSON POST', async () => {
    const result = await guardPost(
      post(
        { ...JSON_TYPE, origin: 'http://localhost:3003', 'sec-fetch-site': 'same-origin' },
        '{"a":1}',
      ),
    );
    expect(result).toEqual({ ok: true, body: '{"a":1}' });
  });

  it('passes a request that has neither Origin nor Sec-Fetch-Site', async () => {
    const result = await guardPost(post(JSON_TYPE, '{}'));
    expect(result).toEqual({ ok: true, body: '{}' });
  });

  it('answers 403 for a cross-origin Origin header', async () => {
    const res = await refusal(post({ ...JSON_TYPE, origin: 'https://evil.example' }, '{}'));
    expect(res.status).toBe(403);
    const unparsable = await refusal(post({ ...JSON_TYPE, origin: 'not a url' }, '{}'));
    expect(unparsable.status).toBe(403);
  });

  it('answers 403 when Sec-Fetch-Site is not same-origin', async () => {
    const res = await refusal(post({ ...JSON_TYPE, 'sec-fetch-site': 'cross-site' }, '{}'));
    expect(res.status).toBe(403);
  });

  it('answers 415 for a body that is not application/json', async () => {
    const res = await refusal(post({ 'content-type': 'text/plain' }, '{}'));
    expect(res.status).toBe(415);
  });

  it('answers 413 when Content-Length is over 1 MB without reading the body', async () => {
    let pulled = false;
    const body = new ReadableStream<Uint8Array>(
      {
        pull() {
          pulled = true;
        },
      },
      { highWaterMark: 0 },
    );
    const request = new Request(URL_, {
      method: 'POST',
      headers: { ...JSON_TYPE, 'content-length': String(MAX_BODY_BYTES + 1) },
      body,
      duplex: 'half',
    } as RequestInit);
    const res = await refusal(request);
    expect(res.status).toBe(413);
    expect(pulled).toBe(false);
  });

  it('answers 413 when the streamed body grows past 1 MB', async () => {
    const chunk = new Uint8Array(256 * 1024);
    let sent = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += 1;
        controller.enqueue(chunk);
      },
      cancel() {
        cancelled = true;
      },
    });
    const request = new Request(URL_, {
      method: 'POST',
      headers: JSON_TYPE,
      body,
      duplex: 'half',
    } as RequestInit);
    const res = await refusal(request);
    expect(res.status).toBe(413);
    expect(cancelled).toBe(true);
    expect(sent).toBeLessThan(10);
  });

  it('answers every refusal with a ChannelAck that carries error.code', async () => {
    const cases: [Request, number, string][] = [
      [post({ ...JSON_TYPE, origin: 'https://evil.example' }, '{}'), 403, 'forbidden'],
      [post({ 'content-type': 'text/plain' }, '{}'), 415, 'unsupported_media_type'],
      [
        post({ ...JSON_TYPE, 'content-length': String(MAX_BODY_BYTES + 1) }, '{}'),
        413,
        'payload_too_large',
      ],
    ];
    for (const [request, status, code] of cases) {
      const res = await refusal(request);
      expect(res.status).toBe(status);
      expect(res.headers.get('content-type')).toContain('application/json');
      expect(await res.json()).toEqual({
        v: 1,
        batchId: '00000000000000000000000000',
        accepted: [],
        trimmed: [],
        error: { code, message: expect.any(String) },
      });
    }
  });
});
