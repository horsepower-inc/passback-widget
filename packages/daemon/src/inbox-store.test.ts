import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse, render, type InboxFile, type MarkStatus } from '@passback/inbox';
import { ackMark, listNeedingAgent, needsAgent, proposeMark } from './inbox-store';

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

describe('inbox-store', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'passback-daemon-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  describe('needsAgent', () => {
    it('does not need an agent when the comment is parked, and needs one again once unparked', () => {
      expect(needsAgent(makeFile({ id: '01P', status: 'new', parked: true }))).toBe(false);
      expect(needsAgent(makeFile({ id: '01P', status: 'ack', parked: true }))).toBe(false);
      expect(needsAgent(makeFile({ id: '01P', status: 'new', parked: undefined }))).toBe(true);
      expect(needsAgent(makeFile({ id: '01P', status: 'ack', parked: undefined }))).toBe(true);
    });

    it('does not list a withdrawn comment as needing an agent', async () => {
      await writeMark(dir, makeFile({ id: '01W', status: 'withdrawn' }));
      expect(needsAgent(makeFile({ id: '01W', status: 'withdrawn' }))).toBe(false);
      expect(await listNeedingAgent(dir)).toEqual([]);
    });

    it('needsAgent is true for a new mark', () => {
      const file = makeFile({ id: '01A', status: 'new' });
      expect(needsAgent(file)).toBe(true);
    });

    it('needsAgent is true for an acked mark with no reply on its current iteration', () => {
      const file = makeFile({ id: '01B', status: 'ack', iteration: 1, iterations: [] });
      expect(needsAgent(file)).toBe(true);
    });

    it('needsAgent is true for a mark reopened by a decline', () => {
      const file = makeFile({
        id: '01C',
        status: 'ack',
        iteration: 2,
        iterations: [
          {
            n: 1,
            agent: { at: '2026-09-19T14:05:00Z', text: 'changed the gap' },
            human: {
              at: '2026-09-19T14:07:00Z',
              verdict: { kind: 'decline', reason: 'still off' },
            },
          },
        ],
      });
      expect(needsAgent(file)).toBe(true);
    });

    it('needsAgent is false once the agent has replied', () => {
      const file = makeFile({
        id: '01D',
        status: 'ack',
        iteration: 1,
        iterations: [{ n: 1, agent: { at: '2026-09-19T14:05:00Z', text: 'fixed it' } }],
      });
      expect(needsAgent(file)).toBe(false);
    });

    it('needsAgent is false for proposed, accepted, verified, declined and withdrawn', () => {
      const statuses: MarkStatus[] = ['proposed', 'accepted', 'verified', 'declined', 'withdrawn'];
      for (const status of statuses) {
        const file = makeFile({ id: '01E', status, iteration: 1, iterations: [] });
        expect(needsAgent(file), status).toBe(false);
      }
    });
  });

  describe('listNeedingAgent', () => {
    it('listNeedingAgent returns marks in id order', async () => {
      await writeMark(dir, makeFile({ id: '01C', status: 'new' }));
      await writeMark(dir, makeFile({ id: '01A', status: 'new' }));
      await writeMark(dir, makeFile({ id: '01B', status: 'new' }));
      const marks = await listNeedingAgent(dir);
      expect(marks.map((m) => m.id)).toEqual(['01A', '01B', '01C']);
    });

    it('listNeedingAgent skips an unparseable file', async () => {
      await writeMark(dir, makeFile({ id: '01A', status: 'new' }));
      await writeFile(path.join(dir, '01B.md'), 'not a valid inbox file');
      const marks = await listNeedingAgent(dir);
      expect(marks.map((m) => m.id)).toEqual(['01A']);
    });

    it('listNeedingAgent ignores attachment directories and tmp files', async () => {
      await writeMark(dir, makeFile({ id: '01A', status: 'new' }));
      await mkdir(path.join(dir, '01A'));
      await writeFile(path.join(dir, '01A', 'wireframe.svg'), '<svg/>');
      await writeFile(path.join(dir, '01Z.md.tmp'), 'partial write');
      const marks = await listNeedingAgent(dir);
      expect(marks.map((m) => m.id)).toEqual(['01A']);
    });

    it('listNeedingAgent returns an empty list for a missing root', async () => {
      const marks = await listNeedingAgent(path.join(dir, 'does-not-exist'));
      expect(marks).toEqual([]);
    });
  });

  describe('ackMark', () => {
    it('ackMark moves new to ack on disk', async () => {
      const target = await writeMark(dir, makeFile({ id: '01A', status: 'new' }));
      const result = await ackMark(dir, '01A');
      expect(result?.status).toBe('ack');
      const onDisk = await readFile(target, 'utf8');
      expect(onDisk).toContain('status: "ack"');
    });

    it('ackMark returns undefined for an already acked mark and writes nothing', async () => {
      const target = await writeMark(dir, makeFile({ id: '01A', status: 'ack' }));
      const before = await readFile(target, 'utf8');
      const result = await ackMark(dir, '01A');
      expect(result).toBeUndefined();
      expect(await readFile(target, 'utf8')).toBe(before);
    });

    it('ackMark returns undefined for a withdrawn mark and writes nothing', async () => {
      const target = await writeMark(dir, makeFile({ id: '01A', status: 'withdrawn' }));
      const before = await readFile(target, 'utf8');
      const result = await ackMark(dir, '01A');
      expect(result).toBeUndefined();
      expect(await readFile(target, 'utf8')).toBe(before);
    });

    it('ackMark returns undefined for a missing file', async () => {
      const result = await ackMark(dir, 'does-not-exist');
      expect(result).toBeUndefined();
    });
  });

  describe('proposeMark', () => {
    it('proposeMark records the reply and moves ack to proposed', async () => {
      const target = await writeMark(dir, makeFile({ id: '01A', status: 'ack' }));
      const reply = { at: '2026-09-19T14:05:00Z', text: 'changed the gap from 12 to 16' };
      const result = await proposeMark(dir, '01A', reply);
      expect(result?.status).toBe('proposed');
      expect(result?.iterations.find((it) => it.n === 1)?.agent).toEqual(reply);
      const onDisk = await readFile(target, 'utf8');
      expect(onDisk).toContain('status: "proposed"');
      expect(onDisk).toContain(reply.text);
    });

    it('proposeMark returns undefined for a withdrawn mark and writes nothing', async () => {
      const target = await writeMark(dir, makeFile({ id: '01A', status: 'withdrawn' }));
      const before = await readFile(target, 'utf8');
      const result = await proposeMark(dir, '01A', {
        at: '2026-09-19T14:05:00Z',
        text: 'fixed it',
      });
      expect(result).toBeUndefined();
      expect(await readFile(target, 'utf8')).toBe(before);
    });
  });

  describe('plain name validation', () => {
    it('a mark id that is not a plain name is rejected', async () => {
      const badIds = ['', 'a/b', 'a\\b', '.', '..', '../x'];
      for (const id of badIds) {
        await expect(ackMark(dir, id)).rejects.toThrow(`not a plain name: ${id}`);
        await expect(
          proposeMark(dir, id, { at: '2026-09-19T14:05:00Z', text: 'x' }),
        ).rejects.toThrow(`not a plain name: ${id}`);
      }
    });
  });

  describe('atomic writes', () => {
    it('a write leaves no tmp file behind', async () => {
      await writeMark(dir, makeFile({ id: '01A', status: 'new' }));
      await ackMark(dir, '01A');
      await proposeMark(dir, '01A', { at: '2026-09-19T14:05:00Z', text: 'fixed it' });
      const entries = await readdir(dir);
      expect(entries.some((name) => name.endsWith('.tmp'))).toBe(false);
    });

    it('two concurrent writes to one mark both land and leave no tmp file', async () => {
      const target = await writeMark(dir, makeFile({ id: '01A', status: 'new' }));
      await Promise.all([
        ackMark(dir, '01A'),
        proposeMark(dir, '01A', { at: '2026-09-19T14:05:00Z', text: 'fixed it' }),
      ]);
      const onDisk = await readFile(target, 'utf8');
      expect(() => parse(onDisk)).not.toThrow();
      const entries = await readdir(dir);
      expect(entries.some((name) => name.endsWith('.tmp'))).toBe(false);
    });
  });
});
