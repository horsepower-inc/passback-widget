import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { InboxFile } from '@passback/inbox';
import { toMarkView } from './mark-view';

function makeFile(overrides: Partial<InboxFile> & { id: string }): InboxFile {
  return {
    schemaVersion: 1,
    batchId: overrides.id,
    category: 'visual',
    status: 'ack',
    iteration: 1,
    route: '/products/:id',
    selector: '[data-testid=price]',
    file: 'src/Price.tsx:12:3',
    buildId: '3f2a9c1',
    createdAt: '2026-09-19T14:00:00Z',
    comment: 'looks off',
    annotations: [],
    iterations: [],
    ...overrides,
  };
}

describe('toMarkView', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'passback-mark-view-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('reshapes an InboxFile with no attachments', async () => {
    const file = makeFile({ id: '01A' });

    const view = await toMarkView(dir, file);

    expect(view).toEqual({
      id: '01A',
      comment: 'looks off',
      route: '/products/:id',
      selector: '[data-testid=price]',
      file: 'src/Price.tsx:12:3',
      buildId: '3f2a9c1',
      inboxFile: path.join(dir, '01A.md'),
    });
  });

  it('includes the screenshot path when screenshot.png exists', async () => {
    const file = makeFile({ id: '01B' });
    await mkdir(path.join(dir, '01B'), { recursive: true });
    await writeFile(path.join(dir, '01B', 'screenshot.png'), Buffer.from([0]));

    const view = await toMarkView(dir, file);

    expect(view.screenshot).toBe(path.join(dir, '01B', 'screenshot.png'));
  });

  it('includes the timeline when payload.json exists and parses', async () => {
    const file = makeFile({ id: '01C' });
    const timeline = [{ t: 0, kind: 'navigation', from: '/a', to: '/b' }];
    await mkdir(path.join(dir, '01C'), { recursive: true });
    await writeFile(path.join(dir, '01C', 'payload.json'), JSON.stringify({ timeline }));

    const view = await toMarkView(dir, file);

    expect(view.timeline).toEqual(timeline);
  });

  it('leaves the timeline out when payload.json does not parse', async () => {
    const file = makeFile({ id: '01D' });
    await mkdir(path.join(dir, '01D'), { recursive: true });
    await writeFile(path.join(dir, '01D', 'payload.json'), '{not json');

    const view = await toMarkView(dir, file);

    expect(view.timeline).toBeUndefined();
  });

  it('leaves file, buildId, screenshot and timeline out when the source has none', async () => {
    const file = makeFile({ id: '01E', file: undefined, buildId: undefined });

    const view = await toMarkView(dir, file);

    expect('file' in view).toBe(false);
    expect('buildId' in view).toBe(false);
    expect('screenshot' in view).toBe(false);
    expect('timeline' in view).toBe(false);
  });

  it('resolves file from a hashed chain in payload.json when the manifest maps it', async () => {
    const file = makeFile({ id: '01F', file: undefined });
    await mkdir(path.join(dir, '01F'), { recursive: true });
    await writeFile(
      path.join(dir, '01F', 'payload.json'),
      JSON.stringify({ code: { framework: 'react', chain: [{ name: 'Price', hash: 'abc123' }] } }),
    );

    const view = await toMarkView(dir, file, { abc123: 'src/Price.tsx:12:3' });

    expect(view.file).toBe('src/Price.tsx:12:3');
  });

  it('leaves file out when the manifest does not map the hash', async () => {
    const file = makeFile({ id: '01G', file: undefined });
    await mkdir(path.join(dir, '01G'), { recursive: true });
    await writeFile(
      path.join(dir, '01G', 'payload.json'),
      JSON.stringify({ code: { framework: 'react', chain: [{ name: 'Price', hash: 'abc123' }] } }),
    );

    const view = await toMarkView(dir, file, { other: 'src/Other.tsx:1:1' });

    expect('file' in view).toBe(false);
  });

  it('leaves file out when no id map is given', async () => {
    const file = makeFile({ id: '01H', file: undefined });
    await mkdir(path.join(dir, '01H'), { recursive: true });
    await writeFile(
      path.join(dir, '01H', 'payload.json'),
      JSON.stringify({ code: { framework: 'react', chain: [{ name: 'Price', hash: 'abc123' }] } }),
    );

    const view = await toMarkView(dir, file);

    expect('file' in view).toBe(false);
  });

  it('keeps the file the inbox file already has', async () => {
    const file = makeFile({ id: '01I', file: 'src/Price.tsx:12:3' });
    await mkdir(path.join(dir, '01I'), { recursive: true });
    await writeFile(
      path.join(dir, '01I', 'payload.json'),
      JSON.stringify({ code: { framework: 'react', chain: [{ name: 'Price', hash: 'abc123' }] } }),
    );

    const view = await toMarkView(dir, file, { abc123: 'src/Other.tsx:1:1' });

    expect(view.file).toBe('src/Price.tsx:12:3');
  });

  it('ignores a payload.json chain that is not an array', async () => {
    const file = makeFile({ id: '01J', file: undefined });
    await mkdir(path.join(dir, '01J'), { recursive: true });
    await writeFile(
      path.join(dir, '01J', 'payload.json'),
      JSON.stringify({ code: { framework: 'react', chain: 'abc123' } }),
    );

    const view = await toMarkView(dir, file, { abc123: 'src/Price.tsx:12:3' });

    expect('file' in view).toBe(false);
  });
});
