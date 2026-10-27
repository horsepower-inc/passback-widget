import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import { ChannelStatus } from '@passback/schema';
import { writeStatus, type StatusInput } from './outbox';
import { FakeClock } from './core/fake-clock';

const MARK_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

const fsHooks = vi.hoisted(() => ({
  writeFileImpl: undefined as ((...args: unknown[]) => Promise<void>) | undefined,
  linkImpl: undefined as ((...args: unknown[]) => Promise<void>) | undefined,
  unlinkImpl: undefined as ((...args: unknown[]) => Promise<void>) | undefined,
}));

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  return {
    ...actual,
    writeFile: async (...args: unknown[]) =>
      fsHooks.writeFileImpl
        ? fsHooks.writeFileImpl(...args)
        : (actual.writeFile as (...a: unknown[]) => Promise<void>)(...args),
    link: async (...args: unknown[]) =>
      fsHooks.linkImpl
        ? fsHooks.linkImpl(...args)
        : (actual.link as (...a: unknown[]) => Promise<void>)(...args),
    unlink: async (...args: unknown[]) =>
      fsHooks.unlinkImpl
        ? fsHooks.unlinkImpl(...args)
        : (actual.unlink as (...a: unknown[]) => Promise<void>)(...args),
  };
});

describe('writeStatus', () => {
  let dir: string;
  let outboxDir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'passback-outbox-'));
    outboxDir = path.join(dir, 'outbox');
  });

  afterEach(async () => {
    fsHooks.writeFileImpl = undefined;
    fsHooks.linkImpl = undefined;
    fsHooks.unlinkImpl = undefined;
    await rm(dir, { recursive: true, force: true });
  });

  async function entries(target: string): Promise<string[]> {
    try {
      return await readdir(target);
    } catch {
      return [];
    }
  }

  it('writes one JSON file that parses with ChannelStatus', async () => {
    const now = (): Date => new Date('2026-09-27T10:00:00.000Z');
    const target = await writeStatus({ markId: MARK_ID, state: 'running' }, { outboxDir, now });

    const files = await entries(outboxDir);
    expect(files).toHaveLength(1);
    expect(path.join(outboxDir, files[0]!)).toBe(target);

    const contents = await readFile(target, 'utf8');
    const event = ChannelStatus.parse(JSON.parse(contents));
    expect(event.markId).toBe(MARK_ID);
    expect(event.state).toBe('running');
  });

  it('creates the outbox directory when it is missing', async () => {
    const nested = path.join(dir, 'a', 'b', 'outbox');
    expect(await entries(nested)).toEqual([]);

    await writeStatus({ markId: MARK_ID, state: 'queued' }, { outboxDir: nested });

    expect(await entries(nested)).toHaveLength(1);
  });

  it('omits message and prUrl when they are not given', async () => {
    const target = await writeStatus({ markId: MARK_ID, state: 'done' }, { outboxDir });

    const event = JSON.parse(await readFile(target, 'utf8')) as Record<string, unknown>;
    expect('message' in event).toBe(false);
    expect('prUrl' in event).toBe(false);
  });

  it('rejects an unknown state and writes nothing', async () => {
    const input = { markId: MARK_ID, state: 'bogus' } as unknown as StatusInput;

    await expect(writeStatus(input, { outboxDir })).rejects.toThrow(ZodError);
    expect(await entries(outboxDir)).toEqual([]);
  });

  it('rejects a markId that is not a ULID and writes nothing', async () => {
    const input: StatusInput = { markId: 'not-a-ulid', state: 'queued' };

    await expect(writeStatus(input, { outboxDir })).rejects.toThrow(ZodError);
    expect(await entries(outboxDir)).toEqual([]);
  });

  it('rejects a prUrl that is not a URL and writes nothing', async () => {
    const input: StatusInput = { markId: MARK_ID, state: 'done', prUrl: 'not-a-url' };

    await expect(writeStatus(input, { outboxDir })).rejects.toThrow(ZodError);
    expect(await entries(outboxDir)).toEqual([]);
  });

  it('names files so that they sort by time', async () => {
    const first = await writeStatus(
      { markId: MARK_ID, state: 'queued' },
      { outboxDir, now: () => new Date('2026-09-27T10:00:00.000Z') },
    );
    const second = await writeStatus(
      { markId: MARK_ID, state: 'running' },
      { outboxDir, now: () => new Date('2026-09-27T10:00:01.000Z') },
    );

    const files = (await entries(outboxDir)).sort();
    expect(files).toEqual([path.basename(first), path.basename(second)]);
  });

  it('never overwrites an existing event file', async () => {
    const now = (): Date => new Date('2026-09-27T10:00:00.000Z');
    const input: StatusInput = { markId: MARK_ID, state: 'failed' };

    const first = await writeStatus(input, { outboxDir, now });
    const second = await writeStatus(input, { outboxDir, now });

    expect(first).not.toBe(second);
    expect(await entries(outboxDir)).toHaveLength(2);
  });

  it('leaves no tmp file behind', async () => {
    await writeStatus({ markId: MARK_ID, state: 'done' }, { outboxDir });

    const files = await entries(outboxDir);
    expect(files.some((name) => name.endsWith('.tmp'))).toBe(false);
  });

  it('takes the event time from an injected clock', async () => {
    const clock = new FakeClock(Date.parse('2026-09-27T10:00:00.000Z'));

    const target = await writeStatus({ markId: MARK_ID, state: 'running' }, { outboxDir, clock });

    const event = JSON.parse(await readFile(target, 'utf8')) as Record<string, unknown>;
    expect(event.at).toBe('2026-09-27T10:00:00.000Z');
  });

  it('a now function wins over an injected clock', async () => {
    const clock = new FakeClock(Date.parse('2026-09-27T10:00:00.000Z'));
    const now = (): Date => new Date('2026-09-27T12:00:00.000Z');

    const target = await writeStatus(
      { markId: MARK_ID, state: 'running' },
      { outboxDir, now, clock },
    );

    const event = JSON.parse(await readFile(target, 'utf8')) as Record<string, unknown>;
    expect(event.at).toBe('2026-09-27T12:00:00.000Z');
  });

  it('writes every event when calls race', async () => {
    const now = (): Date => new Date('2026-09-27T10:00:00.000Z');
    const messages = ['m1', 'm2', 'm3', 'm4', 'm5'];

    const paths = await Promise.all(
      messages.map((message) =>
        writeStatus({ markId: MARK_ID, state: 'running', message }, { outboxDir, now }),
      ),
    );

    expect(new Set(paths).size).toBe(5);
    const files = await entries(outboxDir);
    expect(files.filter((name) => name.endsWith('.json'))).toHaveLength(5);
    expect(files.some((name) => name.endsWith('.tmp'))).toBe(false);

    for (const [index, target] of paths.entries()) {
      const event = JSON.parse(await readFile(target, 'utf8')) as Record<string, unknown>;
      expect(event.message).toBe(messages[index]);
    }
  });

  it('returns an absolute path when outboxDir is relative', async () => {
    const relativeOutboxDir = path.relative(process.cwd(), outboxDir);

    const target = await writeStatus(
      { markId: MARK_ID, state: 'queued' },
      { outboxDir: relativeOutboxDir },
    );

    expect(path.isAbsolute(target)).toBe(true);
    expect(target).toBe(path.resolve(relativeOutboxDir, path.basename(target)));
  });

  it('removes the tmp file when the write fails partway', async () => {
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    fsHooks.writeFileImpl = async (...args: unknown[]) => {
      const [file, , options] = args as Parameters<typeof actual.writeFile>;
      await actual.writeFile(file, 'partial', options);
      throw new Error('disk full');
    };

    await expect(writeStatus({ markId: MARK_ID, state: 'running' }, { outboxDir })).rejects.toThrow(
      'disk full',
    );

    const files = await entries(outboxDir);
    expect(files.some((name) => name.endsWith('.tmp'))).toBe(false);
  });

  it('removes the tmp file when publish fails', async () => {
    const err = Object.assign(new Error('boom'), { code: 'EACCES' });
    fsHooks.linkImpl = async () => {
      throw err;
    };

    await expect(writeStatus({ markId: MARK_ID, state: 'running' }, { outboxDir })).rejects.toBe(
      err,
    );

    const files = await entries(outboxDir);
    expect(files.some((name) => name.endsWith('.tmp'))).toBe(false);
    expect(files.filter((name) => name.endsWith('.json'))).toHaveLength(0);
  });

  it('resolves with the published path when cleanup fails after publish', async () => {
    fsHooks.unlinkImpl = async () => {
      throw new Error('cleanup boom');
    };

    const target = await writeStatus({ markId: MARK_ID, state: 'running' }, { outboxDir });

    const files = await entries(outboxDir);
    const published = files.find((name) => name.endsWith('.json'));
    expect(published).toBeDefined();
    expect(path.join(outboxDir, published!)).toBe(target);
  });

  it('rejects with the write error even when cleanup also fails', async () => {
    const writeErr = new Error('write boom');
    fsHooks.writeFileImpl = async () => {
      throw writeErr;
    };

    await expect(writeStatus({ markId: MARK_ID, state: 'running' }, { outboxDir })).rejects.toBe(
      writeErr,
    );
  });

  it('rejects with the publish error even when cleanup also fails', async () => {
    const publishErr = Object.assign(new Error('link boom'), { code: 'EACCES' });
    fsHooks.linkImpl = async () => {
      throw publishErr;
    };
    fsHooks.unlinkImpl = async () => {
      throw new Error('cleanup boom');
    };

    await expect(writeStatus({ markId: MARK_ID, state: 'running' }, { outboxDir })).rejects.toBe(
      publishErr,
    );
  });
});
