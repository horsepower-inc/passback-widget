import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { render, type InboxFile } from '@passback/inbox';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runClear } from './clear';

let root: string;
let dir: string;
let out: string[];
let err: string[];

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'pb-cli-clear-'));
  dir = path.join(root, '.passback');
  out = [];
  err = [];
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function build(id: string, status: InboxFile['status']): InboxFile {
  return {
    id,
    schemaVersion: 1,
    batchId: 'B1',
    status,
    iteration: 1,
    route: '/home',
    selector: '#hero',
    createdAt: '2026-10-01T10:00:00.000Z',
    comment: `comment ${id}`,
    annotations: [],
    iterations: [{ n: 1 }],
  };
}

/** A project with one accepted comment (one screenshot, one answer), one proposed comment,
 * an outbox file, a done file and a settings file. */
async function project(): Promise<void> {
  const inbox = path.join(dir, 'inbox');
  await mkdir(path.join(inbox, 'A1'), { recursive: true });
  await writeFile(path.join(inbox, 'A1.md'), render(build('A1', 'accepted')));
  await writeFile(path.join(inbox, 'A1', 'shot-0.png'), 'x');
  await writeFile(path.join(inbox, 'P1.md'), render(build('P1', 'proposed')));
  await mkdir(path.join(dir, 'answers'), { recursive: true });
  await writeFile(path.join(dir, 'answers', 'A1.json'), '{}');
  await mkdir(path.join(dir, 'outbox'), { recursive: true });
  await writeFile(path.join(dir, 'outbox', 'e1.json'), '{}');
  await mkdir(path.join(dir, 'done'), { recursive: true });
  await writeFile(path.join(dir, 'done', 'd1.md'), 'x');
  await writeFile(path.join(dir, 'config.json'), '{}');
}

const exists = (p: string) =>
  stat(p).then(
    () => true,
    () => false,
  );
const names = (sub: string) => readdir(path.join(dir, sub)).then((l) => l.sort());

function deps(ask?: (question: string) => Promise<string>) {
  return {
    root,
    ...(ask !== undefined && { ask }),
    out: (line: string) => out.push(line),
    err: (line: string) => err.push(line),
  };
}

const TRACKER_LINE = 'Issues already filed in a tracker stay in the tracker.';

describe('runClear', () => {
  it('clears the fixed scope without asking and prints the counts', async () => {
    await project();
    const asked: string[] = [];
    const code = await runClear(
      { scope: 'fixed', settings: false, yes: false },
      deps(async (q) => {
        asked.push(q);
        return 'no';
      }),
    );
    expect(code).toBe(0);
    expect(asked).toEqual([]);
    expect(out).toEqual([
      'Cleared fixed: 1 comments, 1 attachments, 1 answers, 0 done.',
      TRACKER_LINE,
    ]);
    expect(err).toEqual([]);
    expect(await names('inbox')).toEqual(['P1.md']);
    expect(await names('done')).toEqual(['d1.md']);
  });

  it('asks before a workspace clear and clears after yes while the settings stay', async () => {
    await project();
    const asked: string[] = [];
    const code = await runClear(
      { scope: 'workspace', settings: false, yes: false },
      deps(async (q) => {
        asked.push(q);
        return ' Y ';
      }),
    );
    expect(code).toBe(0);
    expect(asked).toEqual([
      'Clear every comment, screenshot, recording, answer and done file in .passback/? An agent working on a comment is told to stop. Type yes to continue: ',
    ]);
    expect(out).toEqual([
      'Cleared workspace: 2 comments, 1 attachments, 1 answers, 1 done.',
      TRACKER_LINE,
    ]);
    expect(await names('inbox')).toEqual([]);
    expect(await names('outbox')).toEqual([]);
    expect(await names('done')).toEqual([]);
    expect(await exists(path.join(dir, 'config.json'))).toBe(true);
  });

  it('keeps everything when the answer is not yes', async () => {
    await project();
    for (const settings of [false, true]) {
      err = [];
      const code = await runClear(
        { scope: 'workspace', settings, yes: false },
        deps(async () => 'nope'),
      );
      expect(code).toBe(1);
      expect(err).toEqual(['Nothing was cleared.']);
    }
    expect(out).toEqual([]);
    expect(await names('inbox')).toEqual(['A1', 'A1.md', 'P1.md']);
    expect(await names('done')).toEqual(['d1.md']);
    expect(await exists(path.join(dir, 'config.json'))).toBe(true);
  });

  it('does not ask when yes is given', async () => {
    await project();
    const asked: string[] = [];
    const code = await runClear(
      { scope: 'workspace', settings: false, yes: true },
      deps(async (q) => {
        asked.push(q);
        return 'no';
      }),
    );
    expect(code).toBe(0);
    expect(asked).toEqual([]);
    expect(await names('inbox')).toEqual([]);
  });

  it('refuses a workspace clear without a terminal and without yes and names the command to run', async () => {
    await project();
    expect(await runClear({ scope: 'workspace', settings: false, yes: false }, deps())).toBe(1);
    expect(await runClear({ scope: 'workspace', settings: true, yes: false }, deps())).toBe(1);
    expect(err).toEqual([
      'Nothing was cleared. To clear without a prompt, run: npx passback clear --yes',
      'Nothing was cleared. To clear without a prompt, run: npx passback clear --all --yes',
    ]);
    expect(out).toEqual([]);
    expect(await names('inbox')).toEqual(['A1', 'A1.md', 'P1.md']);
    expect(await exists(path.join(dir, 'config.json'))).toBe(true);
  });

  it('deletes the whole folder for settings and says how to set it up again', async () => {
    await project();
    const asked: string[] = [];
    const code = await runClear(
      { scope: 'workspace', settings: true, yes: false },
      deps(async (q) => {
        asked.push(q);
        return 'yes';
      }),
    );
    expect(code).toBe(0);
    expect(asked).toEqual([
      'Delete the whole .passback/ folder, settings included? Run passback init to set it up again. Type yes to continue: ',
    ]);
    expect(out).toEqual([
      'Cleared workspace and settings: 2 comments, 1 attachments, 1 answers, 1 done.',
      'Deleted the .passback folder. Run npx passback init to set it up again.',
      TRACKER_LINE,
    ]);
    expect(await exists(dir)).toBe(false);
  });

  it('prints zero counts for a project without a .passback folder', async () => {
    const code = await runClear({ scope: 'workspace', settings: false, yes: true }, deps());
    expect(code).toBe(0);
    expect(out).toEqual([
      'Cleared workspace: 0 comments, 0 attachments, 0 answers, 0 done.',
      TRACKER_LINE,
    ]);
    expect(err).toEqual([]);
  });
});
