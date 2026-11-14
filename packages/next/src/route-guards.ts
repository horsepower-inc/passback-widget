export const MAX_BODY_BYTES = 1024 * 1024;

export type GuardResult = { ok: true; body: string } | { ok: false; response: Response };

const NIL_BATCH_ID = '00000000000000000000000000';

function refuse(status: number, code: string, message: string): GuardResult {
  const body = {
    v: 1,
    batchId: NIL_BATCH_ID,
    accepted: [],
    trimmed: [],
    error: { code, message },
  };
  return { ok: false, response: Response.json(body, { status }) };
}

function isCrossOrigin(request: Request): boolean {
  const site = request.headers.get('sec-fetch-site');
  if (site !== null && site !== 'same-origin') return true;
  const origin = request.headers.get('origin');
  if (origin === null) return false;
  try {
    const host = request.headers.get('host') ?? new URL(request.url).host;
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}

async function readBounded(request: Request): Promise<string | null> {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function guardPost(request: Request): Promise<GuardResult> {
  try {
    if (isCrossOrigin(request)) return refuse(403, 'forbidden', 'cross-origin request refused');
    const type = (request.headers.get('content-type') ?? '').toLowerCase();
    if (!type.startsWith('application/json')) {
      return refuse(415, 'unsupported_media_type', 'content-type must be application/json');
    }
    const tooLarge = refuse(413, 'payload_too_large', 'body is over 1 MB');
    const length = request.headers.get('content-length');
    if (length !== null && Number(length) > MAX_BODY_BYTES) return tooLarge;
    const body = await readBounded(request);
    return body === null ? tooLarge : { ok: true, body };
  } catch {
    return refuse(400, 'bad_request', 'request body could not be read');
  }
}
