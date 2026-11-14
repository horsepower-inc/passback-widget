import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readManifestIds } from './manifest';

describe('readManifestIds', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'passback-manifest-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function writeManifest(contents: string): Promise<void> {
    await mkdir(path.join(dir, '.passback'), { recursive: true });
    await writeFile(path.join(dir, '.passback', 'manifest.json'), contents);
  }

  it('returns the ids of the requested build id', async () => {
    await writeManifest(JSON.stringify({ abc123: { h1: 'src/A.tsx:1:1', h2: 'src/B.tsx:2:2' } }));

    const ids = await readManifestIds(dir, 'abc123');

    expect(ids).toEqual({ h1: 'src/A.tsx:1:1', h2: 'src/B.tsx:2:2' });
  });

  it('returns undefined when the manifest file is missing', async () => {
    const ids = await readManifestIds(dir, 'abc123');

    expect(ids).toBeUndefined();
  });

  it('returns undefined when the manifest is not valid JSON', async () => {
    await writeManifest('{not json');

    const ids = await readManifestIds(dir, 'abc123');

    expect(ids).toBeUndefined();
  });

  it('returns undefined when the build id is not in the manifest', async () => {
    await writeManifest(JSON.stringify({ abc123: { h1: 'src/A.tsx:1:1' } }));

    const ids = await readManifestIds(dir, 'other');

    expect(ids).toBeUndefined();
  });

  it('returns undefined when no build id is given', async () => {
    await writeManifest(JSON.stringify({ abc123: { h1: 'src/A.tsx:1:1' } }));

    const ids = await readManifestIds(dir, undefined);

    expect(ids).toBeUndefined();
  });

  it('drops a value that is not a string', async () => {
    await writeManifest(JSON.stringify({ abc123: { h1: 'src/A.tsx:1:1', h2: 42, h3: null } }));

    const ids = await readManifestIds(dir, 'abc123');

    expect(ids).toEqual({ h1: 'src/A.tsx:1:1' });
  });

  it('does not treat an inherited key as a build id', async () => {
    await writeManifest(JSON.stringify({ abc123: { h1: 'src/A.tsx:1:1' } }));

    const ids = await readManifestIds(dir, 'toString');

    expect(ids).toBeUndefined();
  });
});
