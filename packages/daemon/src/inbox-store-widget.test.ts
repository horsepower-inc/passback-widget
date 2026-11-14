import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse, render, type InboxFile } from '@passback/inbox';
import { orphanMark, verifyMark } from './inbox-store';

function makeFile(overrides: Partial<InboxFile> & { id: string }): InboxFile {
  return {
    schemaVersion: 1,
    batchId: overrides.id,
    category: 'visual',
    status: 'new',
    iteration: 1,
    route: '/products/:id',
    selector: '[data-testid=price]',
    buildId: '3f2a9c1',
    createdAt: '2026-09-19T14:00:00Z',
    comment: 'looks off',
    annotations: [],
    iterations: [],
    ...overrides,
  };
}

async function writeMark(dir: string, file: InboxFile): Promise<string> {
  const target = path.join(dir, `${file.id}.md`);
  await writeFile(target, render(file));
  return target;
}

describe('inbox-store (widget moves)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'passback-daemon-widget-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  describe('verifyMark', () => {
    it('verifyMark moves proposed to verified on disk', async () => {
      const target = await writeMark(dir, makeFile({ id: '01A', status: 'proposed' }));
      const result = await verifyMark(dir, '01A');
      expect(result?.status).toBe('verified');
      const onDisk = await readFile(target, 'utf8');
      expect(onDisk).toContain('status: "verified"');
    });

    it('verifyMark returns undefined for an acked mark and writes nothing', async () => {
      const target = await writeMark(dir, makeFile({ id: '01A', status: 'ack' }));
      const before = await readFile(target, 'utf8');
      const result = await verifyMark(dir, '01A');
      expect(result).toBeUndefined();
      expect(await readFile(target, 'utf8')).toBe(before);
    });

    it('verifyMark returns undefined for a withdrawn mark and writes nothing', async () => {
      const target = await writeMark(dir, makeFile({ id: '01A', status: 'withdrawn' }));
      const before = await readFile(target, 'utf8');
      const result = await verifyMark(dir, '01A');
      expect(result).toBeUndefined();
      expect(await readFile(target, 'utf8')).toBe(before);
    });

    it('verifyMark returns undefined for a missing file', async () => {
      const result = await verifyMark(dir, 'does-not-exist');
      expect(result).toBeUndefined();
    });
  });

  describe('orphanMark', () => {
    it('orphanMark adds orphaned true and keeps the status', async () => {
      const target = await writeMark(dir, makeFile({ id: '01A', status: 'ack' }));
      const result = await orphanMark(dir, '01A');
      expect(result?.orphaned).toBe(true);
      expect(result?.status).toBe('ack');
      const onDisk = await readFile(target, 'utf8');
      expect(onDisk).toContain('orphaned: true');
      expect(onDisk).toContain('status: "ack"');
    });

    it('orphanMark returns undefined for an already orphaned mark and writes nothing', async () => {
      const target = await writeMark(dir, makeFile({ id: '01A', status: 'ack', orphaned: true }));
      const before = await readFile(target, 'utf8');
      const result = await orphanMark(dir, '01A');
      expect(result).toBeUndefined();
      expect(await readFile(target, 'utf8')).toBe(before);
    });

    it('orphanMark returns undefined for an accepted or withdrawn mark and writes nothing', async () => {
      for (const status of ['accepted', 'withdrawn'] as const) {
        const target = await writeMark(dir, makeFile({ id: `01-${status}`, status }));
        const before = await readFile(target, 'utf8');
        const result = await orphanMark(dir, `01-${status}`);
        expect(result).toBeUndefined();
        expect(await readFile(target, 'utf8')).toBe(before);
      }
    });

    it('an orphaned mark reads back through parse', async () => {
      await writeMark(dir, makeFile({ id: '01A', status: 'verified' }));
      await orphanMark(dir, '01A');
      const onDisk = await readFile(path.join(dir, '01A.md'), 'utf8');
      const parsed = parse(onDisk);
      expect(parsed.orphaned).toBe(true);
      expect(parsed.status).toBe('verified');
    });
  });

  describe('plain name validation', () => {
    it('verifyMark and orphanMark reject an id that is not a plain name', async () => {
      const badIds = ['', 'a/b', 'a\\b', '.', '..', '../x'];
      for (const id of badIds) {
        await expect(verifyMark(dir, id)).rejects.toThrow(`not a plain name: ${id}`);
        await expect(orphanMark(dir, id)).rejects.toThrow(`not a plain name: ${id}`);
      }
    });
  });
});
