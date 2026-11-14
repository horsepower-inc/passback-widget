// The generic hosted call of the CLI: one call helper, and the failure and report shapes.

import { readCredentials } from './credentials';

export type HostedDeps = {
  fetch: typeof fetch;
  credentialsPath: string;
  out: (line: string) => void;
  err: (line: string) => void;
};
export type HostedAnswer =
  | { kind: 'signed_out' }
  | { kind: 'unreachable'; api: string }
  | { kind: 'answer'; api: string; status: number; body: unknown };
export type Failure = { code: string; message: string };

export async function hostedCall(
  deps: HostedDeps,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  urlPath: string,
  body?: unknown,
): Promise<HostedAnswer> {
  const creds = await readCredentials(deps.credentialsPath);
  if (!creds) return { kind: 'signed_out' };
  const headers: Record<string, string> = {
    authorization: `Bearer ${creds.accessToken}`,
    accept: 'application/json',
  };
  if (body !== undefined) headers['content-type'] = 'application/json';
  try {
    const res = await deps.fetch(creds.api + urlPath, {
      method,
      headers,
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    return { kind: 'answer', api: creds.api, status: res.status, body: parseJson(await res.text()) };
  } catch {
    return { kind: 'unreachable', api: creds.api };
  }
}

function parseJson(text: string): unknown {
  try {
    return text === '' ? undefined : JSON.parse(text);
  } catch {
    return undefined;
  }
}

export function commonFailure(answer: HostedAnswer): Failure | undefined {
  if (answer.kind === 'signed_out') {
    return { code: 'signed_out', message: 'Not signed in. Run npx passback login first.' };
  }
  if (answer.kind === 'unreachable') {
    return { code: 'unreachable', message: `Cannot reach ${answer.api}.` };
  }
  if (answer.status === 401) {
    return { code: 'revoked', message: 'Your sign-in has ended. Run npx passback login.' };
  }
  if (answer.status === 429) {
    return {
      code: 'rate_limited',
      message: 'Too many tries. Wait a minute and run it again.',
    };
  }
  if (answer.status === 503) {
    return {
      code: 'unavailable',
      message: `Hosted Passback is not available on ${answer.api} right now.`,
    };
  }
  return undefined;
}

export function report(
  deps: HostedDeps,
  json: boolean,
  event: Record<string, unknown>,
  lines: string[],
): void {
  if (json) {
    deps.out(JSON.stringify(event));
    return;
  }
  for (const line of lines) deps.out(line);
}

export function fail(deps: HostedDeps, json: boolean, failure: Failure): 1 {
  if (json) {
    deps.out(JSON.stringify({ event: 'error', code: failure.code, message: failure.message }));
  } else {
    deps.err(failure.message);
  }
  return 1;
}
