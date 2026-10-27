// passback login, whoami and logout. Every network call and pause goes through AccountDeps.

import { PAUSED_LINE, readBilling } from './billing';
import { readCredentials, removeCredentials, writeCredentials } from './credentials.js';

export const DEFAULT_API = 'https://api.passback.dev';

export function apiBase(flag: string | undefined, env: { PASSBACK_API_URL?: string }): string {
  const chosen = flag || env.PASSBACK_API_URL || DEFAULT_API;
  return chosen.replace(/\/+$/, '');
}

export type AccountDeps = {
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  openUrl: (url: string) => void;
  hostname: string;
  credentialsPath: string;
  out: (line: string) => void;
  err: (line: string) => void;
};

type Me = { email: string; org: string };

async function readJson(res: Response): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await res.json();
    return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function postJson(deps: AccountDeps, url: string, body: unknown): Promise<Response> {
  return deps.fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function getMe(deps: AccountDeps, api: string, token: string): Promise<Response> {
  return deps.fetch(`${api}/v1/customer/me`, {
    method: 'GET',
    headers: { authorization: `Bearer ${token}` },
  });
}

async function parseMe(res: Response): Promise<Me | undefined> {
  const body = await readJson(res);
  const user = body.user as { email?: unknown } | undefined;
  const org = body.org as { name?: unknown } | undefined;
  if (typeof user?.email !== 'string' || typeof org?.name !== 'string') return undefined;
  return { email: user.email, org: org.name };
}

type Failure = { code: string; message: string };
type Grant = { deviceCode: string; userCode: string; verificationUri: string; expiresIn: number };
type Step =
  | { kind: 'again' }
  | { kind: 'slow' }
  | { kind: 'token'; accessToken: string }
  | { kind: 'fail'; failure: Failure };

function unexpected(api: string, status: number): Failure {
  return { code: 'unexpected', message: `Unexpected answer from ${api} (${status}).` };
}

async function startDevice(
  api: string,
  deps: AccountDeps,
): Promise<{ grant: Grant; interval: number } | Failure> {
  let res: Response;
  try {
    res = await postJson(deps, `${api}/v1/auth/device`, { name: deps.hostname });
  } catch {
    return { code: 'unreachable', message: `Cannot reach ${api}.` };
  }
  if (res.status !== 200) {
    return {
      code: 'start_failed',
      message: `Cannot start the sign-in (the server answered ${res.status}). Try again in a minute.`,
    };
  }
  const body = await readJson(res);
  const { deviceCode, userCode, verificationUri, expiresIn } = body;
  if (
    typeof deviceCode !== 'string' ||
    typeof userCode !== 'string' ||
    typeof verificationUri !== 'string' ||
    typeof expiresIn !== 'number'
  ) {
    return unexpected(api, res.status);
  }
  const interval = typeof body.interval === 'number' ? body.interval : 5;
  return { grant: { deviceCode, userCode, verificationUri, expiresIn }, interval };
}

async function pollOnce(api: string, deviceCode: string, deps: AccountDeps): Promise<Step> {
  let res: Response;
  try {
    res = await postJson(deps, `${api}/v1/auth/device/token`, { deviceCode });
  } catch {
    return { kind: 'again' };
  }
  const body = await readJson(res);
  if (res.status === 200) {
    if (typeof body.accessToken === 'string') {
      return { kind: 'token', accessToken: body.accessToken };
    }
    return { kind: 'fail', failure: unexpected(api, res.status) };
  }
  const code = res.status === 400 ? body.code : undefined;
  if (code === 'authorization_pending') return { kind: 'again' };
  if (code === 'slow_down') return { kind: 'slow' };
  if (code === 'access_denied') {
    const message = 'The sign-in was denied in the browser.';
    return { kind: 'fail', failure: { code, message } };
  }
  if (code === 'expired_token') return { kind: 'fail', failure: expiredFailure() };
  return { kind: 'fail', failure: unexpected(api, res.status) };
}

function expiredFailure(): Failure {
  return { code: 'expired_token', message: 'The code expired. Run passback login again.' };
}

async function finishLogin(
  opts: { api: string; json: boolean },
  accessToken: string,
  deps: AccountDeps,
): Promise<number> {
  const { api, json } = opts;
  await writeCredentials(deps.credentialsPath, { v: 1, api, accessToken });
  let me: Me | undefined;
  try {
    const res = await getMe(deps, api, accessToken);
    if (res.status === 200) me = await parseMe(res);
  } catch {
    me = undefined;
  }
  if (json) {
    deps.out(
      JSON.stringify({ event: 'signed_in', email: me?.email ?? null, org: me?.org ?? null }),
    );
  } else {
    deps.out(me ? `Signed in as ${me.email} (${me.org}).` : 'Signed in.');
  }
  return 0;
}

export async function runLogin(
  opts: { api: string; json: boolean },
  deps: AccountDeps,
): Promise<number> {
  const { api, json } = opts;
  const fail = ({ code, message }: Failure): number => {
    if (json) deps.out(JSON.stringify({ event: 'error', code, message }));
    else deps.err(message);
    return 1;
  };

  const started = await startDevice(api, deps);
  if ('code' in started) return fail(started);
  const { grant } = started;
  let interval = started.interval;

  if (json) {
    const { userCode, verificationUri, expiresIn } = grant;
    deps.out(JSON.stringify({ event: 'code', userCode, verificationUri, expiresIn }));
  } else {
    deps.out(`Your code: ${grant.userCode}`);
    deps.out(`Open ${grant.verificationUri} and click Approve.`);
  }
  deps.openUrl(grant.verificationUri);

  let waited = 0;
  for (;;) {
    await deps.sleep(interval * 1000);
    waited += interval;
    if (waited >= grant.expiresIn) return fail(expiredFailure());
    const step = await pollOnce(api, grant.deviceCode, deps);
    if (step.kind === 'token') return finishLogin(opts, step.accessToken, deps);
    if (step.kind === 'fail') return fail(step.failure);
    if (step.kind === 'slow') interval += 5;
  }
}

export async function runWhoami(opts: { json: boolean }, deps: AccountDeps): Promise<number> {
  const { json } = opts;
  const say = (text: string, data: unknown, ok = false): number => {
    if (json) deps.out(JSON.stringify(data));
    else (ok ? deps.out : deps.err)(text);
    return ok ? 0 : 1;
  };
  const creds = await readCredentials(deps.credentialsPath);
  if (!creds) return say('Not signed in. Run passback login.', { signedIn: false });
  let res: Response;
  try {
    res = await getMe(deps, creds.api, creds.accessToken);
  } catch {
    return say(`Cannot reach ${creds.api}.`, { signedIn: null, reason: 'unreachable' });
  }
  if (res.status === 401) {
    return say('Your sign-in has ended. Run passback login.', {
      signedIn: false,
      reason: 'revoked',
    });
  }
  const me = res.status === 200 ? await parseMe(res) : undefined;
  if (!me) {
    return say(unexpected(creds.api, res.status).message, {
      signedIn: null,
      reason: 'unexpected',
    });
  }
  const view = await readBilling(deps);
  const paused = view?.state === 'paused';
  const data = { signedIn: true, email: me.email, org: me.org, api: creds.api, ...(view && { paused }) };
  if (!json && paused) {
    deps.out(`${me.email} · ${me.org} · ${creds.api}`);
    deps.out(PAUSED_LINE);
    deps.out('Pay with npx passback billing.');
    return 0;
  }
  return say(`${me.email} · ${me.org} · ${creds.api}`, data, true);
}

export async function runLogout(opts: { json: boolean }, deps: AccountDeps): Promise<number> {
  const creds = await readCredentials(deps.credentialsPath);
  if (!creds) {
    if (opts.json) deps.out(JSON.stringify({ signedOut: false }));
    else deps.out('Not signed in.');
    return 0;
  }
  try {
    await deps.fetch(`${creds.api}/v1/customer/tokens/current`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${creds.accessToken}` },
    });
  } catch {
    // The local file goes either way; the server token can be revoked from another session.
  }
  await removeCredentials(deps.credentialsPath);
  if (opts.json) deps.out(JSON.stringify({ signedOut: true }));
  else deps.out('Signed out.');
  return 0;
}
