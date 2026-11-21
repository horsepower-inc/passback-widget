// The command-line sign-in token lives in the user's config folder, never in the project.

import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export type Credentials = { v: 1; api: string; accessToken: string };

export function credentialsPath(env: { XDG_CONFIG_HOME?: string }, home: string): string {
  const base = env.XDG_CONFIG_HOME ? env.XDG_CONFIG_HOME : join(home, '.config');
  return join(base, 'passback', 'credentials.json');
}

export async function readCredentials(path: string): Promise<Credentials | undefined> {
  try {
    const data: unknown = JSON.parse(await readFile(path, 'utf8'));
    if (typeof data !== 'object' || data === null) return undefined;
    const { v, api, accessToken } = data as Record<string, unknown>;
    if (v !== 1 || typeof api !== 'string' || typeof accessToken !== 'string') return undefined;
    if (api === '' || accessToken === '') return undefined;
    return { v: 1, api, accessToken };
  } catch {
    return undefined;
  }
}

export async function writeCredentials(path: string, creds: Credentials): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, `${JSON.stringify(creds)}\n`, { mode: 0o600 });
  await rename(tmp, path);
  await chmod(path, 0o600);
}

export async function removeCredentials(path: string): Promise<boolean> {
  try {
    await rm(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}
