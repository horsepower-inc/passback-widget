import type { Screenshot } from '@passback/schema';

export type UploadInput = {
  url: string;
  blob: Blob;
  mime: 'image/webp' | 'image/png';
  width: number;
  height: number;
  masked: number;
  fetchFn?: typeof fetch;
};
export type UploadResult =
  | { ok: true; screenshot: Screenshot }
  | { ok: false; message: string; code?: 'plan_required' };

async function isPlanRequired(response: Response): Promise<boolean> {
  try {
    const body: unknown = await response.json();
    return typeof body === 'object' && body !== null && 'code' in body && body.code === 'plan_required';
  } catch {
    return false;
  }
}

async function readId(response: Response): Promise<string | undefined> {
  try {
    const body: unknown = await response.json();
    if (typeof body !== 'object' || body === null || !('id' in body)) return undefined;
    return typeof body.id === 'string' && /^[0-9a-f]{32}$/.test(body.id) ? body.id : undefined;
  } catch {
    return undefined;
  }
}

export async function uploadShot(input: UploadInput): Promise<UploadResult> {
  try {
    const { url, blob, mime, width, height, masked } = input;
    const response = await (input.fetchFn ?? globalThis.fetch)(url, {
      method: 'POST',
      headers: { 'content-type': mime },
      body: blob,
      credentials: 'omit',
    });
    if (response.status === 403 && (await isPlanRequired(response))) {
      return { ok: false, message: 'HTTP 403', code: 'plan_required' };
    }
    if (response.status !== 201) return { ok: false, message: `HTTP ${response.status}` };
    const id = await readId(response);
    if (!id) return { ok: false, message: 'bad answer from the relay' };
    return { ok: true, screenshot: { id, mime, width, height, bytes: blob.size, masked } };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}
