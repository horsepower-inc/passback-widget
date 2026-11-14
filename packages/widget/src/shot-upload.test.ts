// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { uploadShot, type UploadInput } from './shot-upload';

const id = '0123456789abcdef0123456789abcdef';

function input(fetchFn?: typeof fetch): UploadInput {
  return {
    url: 'https://relay.example/screenshots',
    blob: new Blob(['encoded image']),
    mime: 'image/webp',
    width: 1280,
    height: 720,
    masked: 2,
    fetchFn,
  };
}

describe('uploadShot', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('posts the bytes with the image content type and without credentials', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ id }), { status: 201 }));
    vi.stubGlobal('fetch', fetchFn);
    for (const mime of ['image/webp', 'image/png'] as const) {
      const shot = { ...input(), mime };
      await uploadShot(shot);
      expect(fetchFn).toHaveBeenLastCalledWith(shot.url, {
        method: 'POST',
        headers: { 'content-type': mime },
        body: shot.blob,
        credentials: 'omit',
      });
    }
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('returns the metadata for a 201 with a valid id', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ id, mime: 'image/png', bytes: 999 }), { status: 201 }),
      );
    const shot = input(fetchFn);
    await expect(uploadShot(shot)).resolves.toEqual({
      ok: true,
      screenshot: {
        id,
        mime: shot.mime,
        width: 1280,
        height: 720,
        bytes: shot.blob.size,
        masked: 2,
      },
    });
  });

  it('rejects a 201 whose id is not 32 hex characters', async () => {
    const bodies = [
      {},
      { id: 123 },
      { id: 'a'.repeat(31) },
      { id: 'a'.repeat(33) },
      { id: 'A'.repeat(32) },
      { id: 'g'.repeat(32) },
      null,
      [],
    ];
    for (const body of [...bodies.map((value) => JSON.stringify(value)), '', 'not JSON']) {
      const fetchFn = vi.fn().mockResolvedValue(new Response(body, { status: 201 }));
      await expect(uploadShot(input(fetchFn))).resolves.toEqual({
        ok: false,
        message: 'bad answer from the relay',
      });
    }
  });

  it('reports the status when the relay refuses the upload', async () => {
    for (const status of [200, 403, 413, 415, 429, 500, 502, 503]) {
      const fetchFn = vi.fn().mockResolvedValue(new Response('not JSON', { status }));
      await expect(uploadShot(input(fetchFn))).resolves.toEqual({
        ok: false,
        message: `HTTP ${status}`,
      });
    }
  });

  it('reports plan_required when the relay answers 403 with that code', async () => {
    const body = JSON.stringify({ code: 'plan_required' });
    const fetchFn = vi.fn().mockResolvedValue(new Response(body, { status: 403 }));
    const result = await uploadShot(input(fetchFn));
    expect(result.ok).toBe(false);
    expect(result).toEqual({ ok: false, message: 'HTTP 403', code: 'plan_required' });
  });

  it('reports no code for a 403 with any other body', async () => {
    for (const body of ['', JSON.stringify({ code: 'screenshots_unavailable' })]) {
      const fetchFn = vi.fn().mockResolvedValue(new Response(body, { status: 403 }));
      const result = await uploadShot(input(fetchFn));
      expect(result).toEqual({ ok: false, message: 'HTTP 403' });
      expect(result).not.toHaveProperty('code');
    }
  });

  it('reports the message when the network fails', async () => {
    for (const error of [new Error('network failed'), 'offline', null]) {
      const fetchFn = vi.fn().mockRejectedValue(error);
      await expect(uploadShot(input(fetchFn))).resolves.toEqual({
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });
});
