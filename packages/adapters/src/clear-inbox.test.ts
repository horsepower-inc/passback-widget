import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parse, render, type InboxFile } from '@passback/inbox';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearInbox } from './clear-inbox';

// Lets a test act between the clear reading a held comment and writing its withdraw.
const hook = vi.hoisted(() => ({ beforeWithdraw: undefined as (() => Promise<void>) | undefined }));

vi.mock('./accept-verdict', async (importOriginal) => {
  const real = await importOriginal<typeof import('./accept-verdict')>();
  return {
    ...real,
    acceptVerdict: async (...args: Parameters<typeof real.acceptVerdict>) => {
      await hook.beforeWithdraw?.();
      return real.acceptVerdict(...args);
    },
  };
});

const W1 = '01J8ZKZ8J8ZKZ8J8ZKZ8J8ZKW1';
const W2 = '01J8ZKZ8J8ZKZ8J8ZKZ8J8ZKW2';
const W3 = '01J8ZKZ8J8ZKZ8J8ZKZ8J8ZKW3';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'pb-clear-inbox-'));
  await mkdir(path.join(dir, 'inbox'), { recursive: true });
});

afterEach(async () => {
  hook.beforeWithdraw = undefined;
  await rm(dir, { recursive: true, force: true });
});

function build(
  id: string,
  status: InboxFile['status'],
  opts: { sent?: boolean; parked?: boolean; iterations?: number } = {},
): InboxFile {
  const iterations = Array.from({ length: opts.iterations ?? 1 }, (_, i) => ({ n: i + 1 }));
  return {
    id,
    schemaVersion: 1,
    batchId: 'B1',
    status,
    iteration: iterations.length,
    route: '/home',
    selector: '#hero',
    createdAt: '2026-10-01T10:00:00.000Z',
    comment: `comment ${id}`,
    annotations: [],
    iterations,
    ...(opts.parked ? { parked: true } : {}),
    ...(opts.sent ? { sentToTracker: { tracker: 'linear', ref: 'ISSUE-1' } } : {}),
  };
}

async function put(
  file: InboxFile,
  opts: { attachments?: number; answer?: boolean } = {},
): Promise<void> {
  const inbox = path.join(dir, 'inbox');
  await writeFile(path.join(inbox, `${file.id}.md`), render(file));
  await mkdir(path.join(inbox, file.id), { recursive: true });
  await writeFile(path.join(inbox, file.id, 'payload.json'), '{}');
  for (let i = 0; i < (opts.attachments ?? 0); i++) {
    await writeFile(path.join(inbox, file.id, `shot-${i}.png`), 'x');
  }
  if (opts.answer) {
    await mkdir(path.join(dir, 'answers'), { recursive: true });
    await writeFile(path.join(dir, 'answers', `${file.id}.json`), '{}');
  }
}

async function folder(name: string, files: string[]): Promise<void> {
  await mkdir(path.join(dir, name), { recursive: true });
  for (const f of files) await writeFile(path.join(dir, name, f), 'x');
}

const exists = (p: string) =>
  stat(p).then(
    () => true,
    () => false,
  );
const names = (sub: string) => readdir(path.join(dir, sub)).then((l) => l.sort());

describe('clearInbox', () => {
  it('clears accepted and verified comments with their attachments and answers and counts them', async () => {
    await put(build('A1', 'accepted'), { attachments: 2, answer: true });
    await put(build('V1', 'verified'), { attachments: 1 });
    await put(build('P1', 'proposed'), { attachments: 1, answer: true });
    await folder('done', ['old.md']);
    expect(await clearInbox(dir, { v: 1, scope: 'fixed' })).toEqual({
      ok: true,
      cleared: {
        v: 1,
        scope: 'fixed',
        comments: 2,
        attachments: 3,
        answers: 1,
        done: 0,
        settings: false,
      },
    });
    expect(await names('inbox')).toEqual(['P1', 'P1.md']);
    expect(await names('answers')).toEqual(['P1.json']);
    expect(await names('done')).toEqual(['old.md']);
  });

  it('clears only comments sent to the tracker for the tracker scope and keeps parked ones that were not sent', async () => {
    await put(build('S1', 'proposed', { sent: true }), { attachments: 1 });
    await put(build('S2', 'verified', { sent: true, parked: true }));
    await put(build('K1', 'proposed', { parked: true }));
    await put(build('K2', 'accepted'));
    const result = await clearInbox(dir, { v: 1, scope: 'tracker' });
    expect(result).toEqual({
      ok: true,
      cleared: {
        v: 1,
        scope: 'tracker',
        comments: 2,
        attachments: 1,
        answers: 0,
        done: 0,
        settings: false,
      },
    });
    expect(await names('inbox')).toEqual(['K1', 'K1.md', 'K2', 'K2.md']);
  });

  it('clears every comment, answer, outbox file and done file for the workspace scope and keeps the settings files', async () => {
    await put(build('A1', 'accepted'), { attachments: 1, answer: true });
    await put(build('N1', 'new'), { answer: true });
    await writeFile(path.join(dir, 'inbox', 'broken.md'), 'not a comment');
    await folder('answers', ['stray.json']);
    await folder('outbox', ['e1.json', 'e2.json']);
    await folder('done', ['d1.md', 'd2.md', 'notes.txt']);
    await writeFile(path.join(dir, 'config.json'), '{}');
    const result = await clearInbox(dir, { v: 1, scope: 'workspace' });
    expect(result).toEqual({
      ok: true,
      cleared: {
        v: 1,
        scope: 'workspace',
        comments: 3,
        attachments: 1,
        answers: 3,
        done: 2,
        settings: false,
      },
    });
    expect(await names('inbox')).toEqual([]);
    expect(await names('answers')).toEqual([]);
    expect(await names('outbox')).toEqual([]);
    expect(await names('done')).toEqual([]);
    expect(await exists(path.join(dir, 'config.json'))).toBe(true);
  });

  it('withdraws a comment the agent is working on and keeps its file and folder instead of deleting them', async () => {
    await put(build(W1, 'ack', { iterations: 2 }), { attachments: 1, answer: true });
    await put(build('A1', 'accepted'));
    const result = await clearInbox(dir, { v: 1, scope: 'workspace' });
    expect(result).toMatchObject({ ok: true, cleared: { comments: 1, attachments: 0 } });
    const kept = parse(await readFile(path.join(dir, 'inbox', `${W1}.md`), 'utf8'));
    expect(kept.status).toBe('withdrawn');
    expect(await names('inbox/' + W1)).toEqual(['payload.json', 'shot-0.png']);
    expect(await exists(path.join(dir, 'inbox', 'A1.md'))).toBe(false);

    const fixed = build(W2, 'ack');
    await put(fixed);
    await clearInbox(dir, { v: 1, scope: 'fixed' });
    expect(parse(await readFile(path.join(dir, 'inbox', `${W2}.md`), 'utf8')).status).toBe('ack');

    await put(build(W3, 'ack', { sent: true }));
    const tracker = await clearInbox(dir, { v: 1, scope: 'tracker' });
    expect(tracker).toMatchObject({ ok: true, cleared: { comments: 0 } });
    expect(parse(await readFile(path.join(dir, 'inbox', `${W3}.md`), 'utf8')).status).toBe(
      'withdrawn',
    );

    // a second clear removes the withdrawn comment
    expect(await clearInbox(dir, { v: 1, scope: 'tracker' })).toMatchObject({
      ok: true,
      cleared: { comments: 1 },
    });
    expect(await exists(path.join(dir, 'inbox', `${W3}.md`))).toBe(false);

    // a withdraw that cannot be written fails the clear and leaves the comment held
    const W4 = '01J8ZKZ8J8ZKZ8J8ZKZ8J8ZKW4';
    await put(build(W4, 'ack', { sent: true }));
    await chmod(path.join(dir, 'inbox'), 0o555);
    try {
      expect(await clearInbox(dir, { v: 1, scope: 'tracker' })).toEqual({
        ok: false,
        error: 'failed',
      });
    } finally {
      await chmod(path.join(dir, 'inbox'), 0o755);
    }
    expect(parse(await readFile(path.join(dir, 'inbox', `${W4}.md`), 'utf8')).status).toBe('ack');
    await rm(path.join(dir, 'inbox', `${W4}.md`));

    // a held comment that vanishes before its withdraw is written counts zero, not a failure
    const W5 = '01J8ZKZ8J8ZKZ8J8ZKZ8J8ZKW5';
    await put(build(W5, 'ack', { sent: true }));
    hook.beforeWithdraw = () => rm(path.join(dir, 'inbox', `${W5}.md`));
    expect(await clearInbox(dir, { v: 1, scope: 'tracker' })).toMatchObject({
      ok: true,
      cleared: { comments: 0, attachments: 0, answers: 0 },
    });
  });

  it('removes the whole folder when settings is true and reports it', async () => {
    await put(build(W1, 'ack'), { attachments: 2, answer: true });
    await put(build('A1', 'accepted'));
    await folder('outbox', ['e1.json']);
    await folder('done', ['d1.md']);
    await writeFile(path.join(dir, 'config.json'), '{}');
    const result = await clearInbox(dir, { v: 1, scope: 'workspace', settings: true });
    expect(result).toEqual({
      ok: true,
      cleared: {
        v: 1,
        scope: 'workspace',
        comments: 2,
        attachments: 2,
        answers: 1,
        done: 1,
        settings: true,
      },
    });
    expect(await exists(dir)).toBe(false);
  });

  it('answers invalid for a bad request and zero counts for a missing folder and never throws', async () => {
    await put(build('A1', 'accepted'));
    for (const bad of [
      undefined,
      null,
      { v: 1, scope: 'everything' },
      { v: 1, scope: 'fixed', settings: true },
    ]) {
      expect(await clearInbox(dir, bad)).toEqual({ ok: false, error: 'invalid' });
    }
    expect(await exists(path.join(dir, 'inbox', 'A1.md'))).toBe(true);

    const missing = path.join(dir, 'nowhere');
    for (const scope of ['fixed', 'tracker', 'workspace'] as const) {
      expect(await clearInbox(missing, { v: 1, scope })).toEqual({
        ok: true,
        cleared: { v: 1, scope, comments: 0, attachments: 0, answers: 0, done: 0, settings: false },
      });
    }
    expect(await clearInbox(missing, { v: 1, scope: 'workspace', settings: true })).toMatchObject({
      ok: true,
      cleared: { comments: 0, settings: true },
    });

    // the inbox is a file, so listing it fails with something other than a missing path
    const odd = await mkdtemp(path.join(tmpdir(), 'pb-clear-inbox-odd-'));
    try {
      await writeFile(path.join(odd, 'inbox'), 'x');
      expect(await clearInbox(odd, { v: 1, scope: 'fixed' })).toEqual({
        ok: false,
        error: 'failed',
      });

      // a comment that cannot be read fails every scope instead of passing as unparseable
      await rm(path.join(odd, 'inbox'));
      await mkdir(path.join(odd, 'inbox', 'R1.md'), { recursive: true });
      for (const scope of ['fixed', 'tracker', 'workspace'] as const) {
        expect(await clearInbox(odd, { v: 1, scope })).toEqual({ ok: false, error: 'failed' });
      }
      expect(await exists(path.join(odd, 'inbox', 'R1.md'))).toBe(true);
    } finally {
      await rm(odd, { recursive: true, force: true });
    }
  });
});
