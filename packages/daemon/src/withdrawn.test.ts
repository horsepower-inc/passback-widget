import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, type InboxFile } from '@passback/inbox';
import { rememberHandedOver, takeWithdrawn } from './withdrawn';

function makeFile(overrides: Partial<InboxFile> & { id: string }): InboxFile {
  return {
    schemaVersion: 1,
    batchId: overrides.id,
    category: 'visual',
    status: 'ack',
    iteration: 1,
    route: '/',
    selector: '[data-testid=price]',
    buildId: '3f2a9c1',
    createdAt: '2026-09-19T14:00:00Z',
    comment: 'looks off',
    annotations: [],
    iterations: [],
    ...overrides,
  };
}

describe('withdrawn', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'passback-withdrawn-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function write(file: InboxFile): Promise<void> {
    await writeFile(path.join(dir, `${file.id}.md`), render(file));
  }

  it('reports a handed-over comment that was withdrawn before the agent replied, once', async () => {
    await write(makeFile({ id: '01B', status: 'ack' }));
    await write(makeFile({ id: '01A', status: 'ack' }));
    rememberHandedOver(dir, ['01B', '01A']);
    expect(await takeWithdrawn(dir)).toEqual([]);
    await write(makeFile({ id: '01B', status: 'withdrawn' }));
    await write(makeFile({ id: '01A', status: 'withdrawn' }));
    expect(await takeWithdrawn(dir)).toEqual(['01A', '01B']);
    expect(await takeWithdrawn(dir)).toEqual([]);
  });

  it('forgets a handed-over comment that has an agent reply on its current iteration', async () => {
    await write(makeFile({ id: '01C', status: 'ack' }));
    rememberHandedOver(dir, ['01C']);
    await write(
      makeFile({
        id: '01C',
        status: 'proposed',
        iterations: [{ n: 1, agent: { at: '2026-09-19T14:05:00Z', text: 'fixed' } }],
      }),
    );
    expect(await takeWithdrawn(dir)).toEqual([]);
    await write(
      makeFile({
        id: '01C',
        status: 'withdrawn',
        iterations: [{ n: 1, agent: { at: '2026-09-19T14:05:00Z', text: 'fixed' } }],
      }),
    );
    expect(await takeWithdrawn(dir)).toEqual([]);
  });

  it('does not report a comment this process never handed over', async () => {
    await write(makeFile({ id: '01D', status: 'withdrawn' }));
    expect(await takeWithdrawn(dir)).toEqual([]);
  });

  it('forgets a missing or unparsable file and never throws', async () => {
    await writeFile(path.join(dir, '01E.md'), 'not an inbox file');
    rememberHandedOver(dir, ['01E', '01F']);
    expect(await takeWithdrawn(dir)).toEqual([]);
    await write(makeFile({ id: '01E', status: 'withdrawn' }));
    await write(makeFile({ id: '01F', status: 'withdrawn' }));
    expect(await takeWithdrawn(dir)).toEqual([]);
  });
});
