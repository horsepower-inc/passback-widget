import { describe, expect, it, vi } from 'vitest';
import { probeVoice, uploadVoice, voiceUrlOf } from './voice-upload';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const fake = (response: Response | Error) =>
  vi.fn(async () => {
    if (response instanceof Error) throw response;
    return response;
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
const blob = new Blob(['x'], { type: 'audio/webm' });

describe('voice upload', () => {
  it('probes the voice route and accepts only voice true', async () => {
    expect(voiceUrlOf('https://r.test/v1/ingest/s1//')).toBe('https://r.test/v1/ingest/s1/voice');
    const ok = fake(json({ voice: true }));
    expect(await probeVoice('u', ok)).toBe(true);
    expect(ok).toHaveBeenCalledWith('u', { method: 'GET', credentials: 'omit' });
    expect(await probeVoice('u', fake(json({ voice: false })))).toBe(false);
    expect(await probeVoice('u', fake(json({ voice: 'true' })))).toBe(false);
    expect(await probeVoice('u', fake(json({ voice: true }, 404)))).toBe(false);
    expect(await probeVoice('u', fake(new Error('offline')))).toBe(false);
  });

  it('posts the recording with its mime type and no credentials', async () => {
    const f = fake(json({ text: 'hi' }));
    await uploadVoice({ url: 'u', blob, mime: 'audio/webm;codecs=opus', fetchFn: f });
    expect(f).toHaveBeenCalledWith('u', {
      method: 'POST',
      headers: { 'content-type': 'audio/webm;codecs=opus' },
      body: blob,
      credentials: 'omit',
    });
  });

  it('returns the transcript text on 200', async () => {
    expect(
      await uploadVoice({
        url: 'u',
        blob,
        mime: 'audio/mp4',
        fetchFn: fake(json({ text: 'hello there' })),
      }),
    ).toEqual({
      ok: true,
      text: 'hello there',
    });
  });

  it('maps 403 plan_required, 503, 422 and 413 to their codes', async () => {
    const code = async (r: Response) =>
      uploadVoice({ url: 'u', blob, mime: 'audio/mp4', fetchFn: fake(r) });
    expect(await code(json({ code: 'plan_required' }, 403))).toEqual({
      ok: false,
      code: 'plan_required',
    });
    expect(await code(json({ code: 'voice_unavailable' }, 503))).toEqual({
      ok: false,
      code: 'voice_unavailable',
    });
    expect(await code(json({}, 422))).toEqual({ ok: false, code: 'no_speech' });
    expect(await code(json({}, 413))).toEqual({ ok: false, code: 'too_large' });
    expect(await code(json({}, 500))).toEqual({ ok: false, code: 'failed' });
    expect(await code(json({ code: 'other' }, 403))).toEqual({ ok: false, code: 'failed' });
  });

  it('maps a network error and a bad body to failed without rejecting', async () => {
    const failed = { ok: false, code: 'failed' };
    expect(
      await uploadVoice({ url: 'u', blob, mime: 'audio/mp4', fetchFn: fake(new Error('offline')) }),
    ).toEqual(failed);
    expect(
      await uploadVoice({ url: 'u', blob, mime: 'audio/mp4', fetchFn: fake(new Response('nope')) }),
    ).toEqual(failed);
    expect(
      await uploadVoice({ url: 'u', blob, mime: 'audio/mp4', fetchFn: fake(json({ text: 3 })) }),
    ).toEqual(failed);
  });
});
