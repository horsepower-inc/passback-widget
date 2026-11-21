import type { Rect } from '@passback/schema';
import { ANNOTATION_TOLERANCE } from './annotation-check';

export type RectSnapshot = {
  v: 1;
  route: string;
  viewport: [number, number];
  rects: Record<string, Rect>;
};

export type SnapshotFile = { v: 1; snapshots: RectSnapshot[] };

export type SnapshotDiff = {
  key: string;
  moved: string[];
  resized: string[];
  added: string[];
  removed: string[];
};

export function snapshotKey(s: RectSnapshot): string {
  return `${s.route}@${s.viewport[0]}x${s.viewport[1]}`;
}

function byName(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function changeOf(base: Rect, head: Rect, tolerance: number): 'resized' | 'moved' | undefined {
  if (
    Math.abs(base.width - head.width) > tolerance ||
    Math.abs(base.height - head.height) > tolerance
  ) {
    return 'resized';
  }
  if (Math.abs(base.x - head.x) > tolerance || Math.abs(base.y - head.y) > tolerance) {
    return 'moved';
  }
  return undefined;
}

export function diffSnapshots(
  base: RectSnapshot,
  head: RectSnapshot,
  tolerance: number = ANNOTATION_TOLERANCE,
): SnapshotDiff {
  const key = snapshotKey(base);
  if (key !== snapshotKey(head)) throw new Error('snapshots differ in route or viewport');
  const diff: SnapshotDiff = { key, moved: [], resized: [], added: [], removed: [] };
  for (const [name, rect] of Object.entries(head.rects)) {
    const before = base.rects[name];
    if (!before) {
      diff.added.push(name);
      continue;
    }
    const change = changeOf(before, rect, tolerance);
    if (change) diff[change].push(name);
  }
  for (const name of Object.keys(base.rects)) {
    if (!(name in head.rects)) diff.removed.push(name);
  }
  diff.moved.sort(byName);
  diff.resized.sort(byName);
  diff.added.sort(byName);
  diff.removed.sort(byName);
  return diff;
}

function indexByKey(file: SnapshotFile): Map<string, RectSnapshot> {
  return new Map(file.snapshots.map((s) => [snapshotKey(s), s]));
}

export function diffSnapshotFiles(
  base: SnapshotFile,
  head: SnapshotFile,
  tolerance?: number,
): { diffs: SnapshotDiff[]; onlyInBase: string[]; onlyInHead: string[] } {
  const baseByKey = indexByKey(base);
  const headByKey = indexByKey(head);
  const diffs: SnapshotDiff[] = [];
  const onlyInBase: string[] = [];
  for (const [key, snapshot] of baseByKey) {
    const other = headByKey.get(key);
    if (other) diffs.push(diffSnapshots(snapshot, other, tolerance));
    else onlyInBase.push(key);
  }
  const onlyInHead = [...headByKey.keys()].filter((key) => !baseByKey.has(key));
  diffs.sort((a, b) => byName(a.key, b.key));
  return { diffs, onlyInBase: onlyInBase.sort(byName), onlyInHead: onlyInHead.sort(byName) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRect(value: unknown): boolean {
  return (
    isRecord(value) &&
    ['x', 'y', 'width', 'height'].every((field) => typeof value[field] === 'number')
  );
}

function snapshotProblem(s: unknown): string | undefined {
  if (!isRecord(s)) return 'snapshot is not an object';
  if (typeof s['route'] !== 'string') return 'route is not a string';
  const viewport = s['viewport'];
  if (
    !Array.isArray(viewport) ||
    viewport.length !== 2 ||
    !viewport.every((n) => typeof n === 'number')
  ) {
    return 'viewport is not two numbers';
  }
  const rects = s['rects'];
  if (!isRecord(rects)) return 'rects is not an object';
  if (!Object.values(rects).every(isRect)) return 'a rect lacks numeric x, y, width, height';
  return undefined;
}

function fileProblem(data: unknown): string | undefined {
  if (!isRecord(data)) return 'not an object';
  if (data['v'] !== 1) return 'v is not 1';
  const snapshots = data['snapshots'];
  if (!Array.isArray(snapshots)) return 'snapshots is not an array';
  for (const s of snapshots) {
    const problem = snapshotProblem(s);
    if (problem) return problem;
  }
  return undefined;
}

export function parseSnapshotFile(text: string): SnapshotFile {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('invalid snapshot file: not JSON');
  }
  const problem = fileProblem(data);
  if (problem) throw new Error(`invalid snapshot file: ${problem}`);
  return data as SnapshotFile;
}
