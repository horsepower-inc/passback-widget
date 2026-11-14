import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runPrCheck } from './pr-check';

let tmpDir: string | undefined;

afterEach(async () => {
  if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  tmpDir = undefined;
});

type R = { x: number; y: number; width: number; height: number };
const r = (x: number, y: number, width: number, height: number): R => ({ x, y, width, height });

function snap(rects: Record<string, R>, viewport: [number, number] = [1000, 800], route = '/home') {
  return { route, viewport, rects };
}

async function dir(): Promise<string> {
  tmpDir ??= await mkdtemp(path.join(os.tmpdir(), 'passback-pr-check-'));
  return tmpDir;
}

async function write(name: string, content: unknown): Promise<string> {
  const d = await dir();
  const file = path.join(d, name);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, typeof content === 'string' ? content : JSON.stringify(content));
  return file;
}

async function snapshots(name: string, list: ReturnType<typeof snap>[]): Promise<string> {
  return write(name, { v: 1, snapshots: list });
}

function io() {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { out: (l: string) => out.push(l), err: (l: string) => err.push(l) } };
}

describe('runPrCheck', () => {
  it('exits 0 and lists the moved element for a clean layout', async () => {
    const base = await snapshots('base.json', [
      snap({ a: r(0, 0, 100, 50), b: r(0, 100, 100, 50) }),
    ]);
    const head = await snapshots('head.json', [
      snap({ a: r(0, 0, 100, 50), b: r(0, 200, 100, 50) }),
    ]);
    const c = io();
    expect(await runPrCheck({ base, head, json: false }, c.io)).toBe(0);
    expect(c.out[0]).toBe(
      'passback pr-check: pass (0 layout findings, 0 failed assertions, 1 changed elements)',
    );
    expect(c.out.join('\n')).toContain('### Changed');
    expect(c.out.join('\n')).toContain('moved b');
    expect(c.out.join('\n')).not.toContain('### Layout findings');
    expect(c.err).toEqual([]);
  });

  it('exits 1 on an overlap finding in the head snapshot', async () => {
    const base = await snapshots('base.json', [
      snap({ a: r(0, 0, 100, 50), b: r(0, 100, 100, 50) }),
    ]);
    const head = await snapshots('head.json', [
      snap({ a: r(0, 0, 100, 50), b: r(0, 20, 100, 50) }),
    ]);
    const c = io();
    expect(await runPrCheck({ base, head, json: false }, c.io)).toBe(1);
    expect(c.out[0]).toContain('passback pr-check: findings (1 layout findings');
    expect(c.out.join('\n')).toContain('### Layout findings');
    expect(c.out.join('\n')).toContain('overlap a, b');
  });

  it('exits 1 on a failed assertion for the matching viewport', async () => {
    const s = [snap({ a: r(0, 0, 100, 50), b: r(10, 100, 100, 50) })];
    const base = await snapshots('base.json', s);
    const head = await snapshots('head.json', s);
    await write('assertions/m1.json', {
      v: 1,
      markId: 'm1',
      viewport: [1000, 800],
      annotations: [{ type: 'align', edge: 'left', a: 'a', b: 'b', actual: { a: 0, b: 10 } }],
    });
    const c = io();
    const code = await runPrCheck(
      { base, head, assertionsDir: path.join(await dir(), 'assertions'), json: false },
      c.io,
    );
    expect(code).toBe(1);
    expect(c.out[0]).toContain('(0 layout findings, 1 failed assertions, 0 changed elements)');
    expect(c.out.join('\n')).toContain('### Failed assertions');
  });

  it('ignores an assertion for another viewport and one whose names are missing', async () => {
    const s = [snap({ a: r(0, 0, 100, 50), b: r(10, 100, 100, 50) })];
    const base = await snapshots('base.json', s);
    const head = await snapshots('head.json', s);
    await write('assertions/other.json', {
      v: 1,
      markId: 'm1',
      viewport: [375, 800],
      annotations: [{ type: 'align', edge: 'left', a: 'a', b: 'b', actual: { a: 0, b: 10 } }],
    });
    await write('assertions/missing.json', {
      v: 1,
      markId: 'm2',
      viewport: [1000, 800],
      annotations: [{ type: 'align', edge: 'left', a: 'a', b: 'ghost', actual: { a: 0, b: 10 } }],
    });
    const c = io();
    const code = await runPrCheck(
      { base, head, assertionsDir: path.join(await dir(), 'assertions'), json: false },
      c.io,
    );
    expect(code).toBe(0);
    expect(c.out[0]).toContain('pass (0 layout findings, 0 failed assertions');
  });

  it('lists snapshots present on one side only', async () => {
    const base = await snapshots('base.json', [snap({ a: r(0, 0, 10, 10) }, [1000, 800], '/old')]);
    const head = await snapshots('head.json', [snap({ a: r(0, 0, 10, 10) }, [1000, 800], '/new')]);
    const c = io();
    expect(await runPrCheck({ base, head, json: false }, c.io)).toBe(0);
    const text = c.out.join('\n');
    expect(text).toContain('### Not compared');
    expect(text).toContain('/old@1000x800: only in base');
    expect(text).toContain('/new@1000x800: only in head');
  });

  it('prints structured json with json true', async () => {
    const base = await snapshots('base.json', [snap({ a: r(0, 0, 100, 50) })]);
    const head = await snapshots('head.json', [snap({ a: r(0, 40, 100, 50) })]);
    const c = io();
    expect(await runPrCheck({ base, head, json: true }, c.io)).toBe(0);
    expect(c.out).toHaveLength(1);
    expect(JSON.parse(c.out[0] as string)).toEqual({
      status: 'pass',
      diffs: [{ key: '/home@1000x800', moved: ['a'], resized: [], added: [], removed: [] }],
      findings: [],
      failed: [],
      onlyInBase: [],
      onlyInHead: [],
    });
  });

  it('exits 2 and names the file when a snapshot file is malformed', async () => {
    const base = await snapshots('base.json', [snap({ a: r(0, 0, 10, 10) })]);
    const head = await write('head.json', 'secret-content {');
    const c = io();
    expect(await runPrCheck({ base, head, json: false }, c.io)).toBe(2);
    expect(c.out).toEqual([]);
    expect(c.err).toHaveLength(1);
    expect(c.err[0]).toContain('passback pr-check: ');
    expect(c.err[0]).toContain(head);
    expect(c.err[0]).not.toContain('secret-content');

    // An assertion file that parses but carries an annotation the checker cannot read.
    const good = await snapshots('good.json', [snap({ a: r(0, 0, 10, 10) })]);
    const bad = await write('bad-assertions/m2.json', {
      v: 1,
      markId: 'm2',
      viewport: [1000, 800],
      annotations: [{ type: 'no-overlap' }],
    });
    const d = io();
    const code = await runPrCheck(
      { base: good, head: good, assertionsDir: path.dirname(bad), json: false },
      d.io,
    );
    expect(code).toBe(2);
    expect(d.out).toEqual([]);
    expect(d.err).toHaveLength(1);
    expect(d.err[0]).toContain('passback pr-check: ');
    expect(d.err[0]).toContain(bad);
  });
});
