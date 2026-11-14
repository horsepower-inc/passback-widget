export type VoiceCode =
  'plan_required' | 'voice_unavailable' | 'no_speech' | 'too_large' | 'failed';
export type VoiceResult = { ok: true; text: string } | { ok: false; code: VoiceCode };

export function voiceUrlOf(endpoint: string): string {
  return `${endpoint.replace(/\/+$/, '')}/voice`;
}

async function readBody(response: Response): Promise<Record<string, unknown> | undefined> {
  try {
    const body: unknown = await response.json();
    return typeof body === 'object' && body !== null
      ? (body as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

export async function probeVoice(url: string, fetchFn?: typeof fetch): Promise<boolean> {
  try {
    const response = await (fetchFn ?? globalThis.fetch)(url, {
      method: 'GET',
      credentials: 'omit',
    });
    if (response.status !== 200) return false;
    return (await readBody(response))?.voice === true;
  } catch {
    return false;
  }
}

export async function uploadVoice(input: {
  url: string;
  blob: Blob;
  mime: string;
  fetchFn?: typeof fetch;
}): Promise<VoiceResult> {
  try {
    const response = await (input.fetchFn ?? globalThis.fetch)(input.url, {
      method: 'POST',
      headers: { 'content-type': input.mime },
      body: input.blob,
      credentials: 'omit',
    });
    if (response.status === 200) {
      const text = (await readBody(response))?.text;
      return typeof text === 'string' ? { ok: true, text } : { ok: false, code: 'failed' };
    }
    if (response.status === 403) {
      return (await readBody(response))?.code === 'plan_required'
        ? { ok: false, code: 'plan_required' }
        : { ok: false, code: 'failed' };
    }
    if (response.status === 503) return { ok: false, code: 'voice_unavailable' };
    if (response.status === 422) return { ok: false, code: 'no_speech' };
    if (response.status === 413) return { ok: false, code: 'too_large' };
    return { ok: false, code: 'failed' };
  } catch {
    return { ok: false, code: 'failed' };
  }
}
