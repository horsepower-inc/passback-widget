import { chmod, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  credentialsPath,
  readCredentials,
  removeCredentials,
  writeCredentials,
} from './credentials.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'passback-creds-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const creds = { v: 1 as const, api: 'https://api.example.test', accessToken: 'tok' };

describe('credentials', () => {
  it('puts the file under XDG_CONFIG_HOME or ~/.config, never the project', () => {
    expect(credentialsPath({ XDG_CONFIG_HOME: '/x/cfg' }, '/home/u')).toBe(
      '/x/cfg/passback/credentials.json',
    );
    expect(credentialsPath({}, '/home/u')).toBe('/home/u/.config/passback/credentials.json');
    expect(credentialsPath({ XDG_CONFIG_HOME: '' }, '/home/u')).toBe(
      '/home/u/.config/passback/credentials.json',
    );
  });

  it('writes the credentials readable only by the user', async () => {
    const path = join(dir, 'new', 'passback', 'credentials.json');
    await writeCredentials(path, creds);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect((await stat(join(dir, 'new', 'passback'))).mode & 0o777).toBe(0o700);

    const old = join(dir, 'old.json');
    await writeFile(old, '{}', { mode: 0o644 });
    await chmod(old, 0o644);
    await writeCredentials(old, creds);
    expect((await stat(old)).mode & 0o777).toBe(0o600);
  });

  it('reads back what it wrote and treats a broken file as signed out', async () => {
    const path = join(dir, 'passback', 'credentials.json');
    await writeCredentials(path, creds);
    expect(await readCredentials(path)).toEqual(creds);

    expect(await readCredentials(join(dir, 'missing.json'))).toBeUndefined();
    await mkdir(join(dir, 'd'));
    expect(await readCredentials(join(dir, 'd'))).toBeUndefined();
    await writeFile(path, 'not json');
    expect(await readCredentials(path)).toBeUndefined();
    await writeFile(path, JSON.stringify({ v: 2, api: 'a', accessToken: 't' }));
    expect(await readCredentials(path)).toBeUndefined();
    await writeFile(path, JSON.stringify({ v: 1, api: 'a' }));
    expect(await readCredentials(path)).toBeUndefined();
  });

  it('removes the file and reports whether there was one', async () => {
    const path = join(dir, 'passback', 'credentials.json');
    await writeCredentials(path, creds);
    expect(await removeCredentials(path)).toBe(true);
    expect(await removeCredentials(path)).toBe(false);
    expect(await readCredentials(path)).toBeUndefined();
  });
});
