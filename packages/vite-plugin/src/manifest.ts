// local manifest mapping hash ids back to file:line:col per build id.

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashLocation } from './hash';
import { formatLoc, type SourceLoc } from './inject';

export type Manifest = Record<string, Record<string, string>>;

function isPlainObject(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isManifest(value: unknown): value is Manifest {
  return isPlainObject(value) && Object.values(value as object).every(isPlainObject);
}

export function mergeManifest(
  existing: unknown,
  buildId: string,
  ids: ReadonlyMap<string, string>,
): Manifest {
  const base = isManifest(existing) ? existing : {};
  return { ...base, [buildId]: Object.fromEntries(ids) };
}

export function writeManifest(
  root: string,
  buildId: string,
  ids: ReadonlyMap<string, string>,
): string {
  const dir = join(root, '.passback');
  const file = join(dir, 'manifest.json');
  let existing: unknown;
  try {
    existing = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    existing = undefined;
  }
  const merged = mergeManifest(existing, buildId, ids);
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, `${JSON.stringify(merged, null, 2)}\n`);
  return file;
}

export function writeManifestOnClose(
  state: { root: string; command: 'build' | 'serve'; sourceIds: ReadonlyMap<string, string> },
  buildIdOption: string | undefined,
  warn: (message: string) => void,
): void {
  const { root, command, sourceIds } = state;
  if (command !== 'build' || sourceIds.size === 0) return;
  const buildId = buildIdOption ?? gitBuildId(root);
  if (buildId === undefined) {
    warn(
      'passback: no build id (not a git repo); pass passback({ buildId }) to write .passback/manifest.json',
    );
    return;
  }
  writeManifest(root, buildId, sourceIds);
}

export function gitBuildId(root: string): string | undefined {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
  } catch {
    return undefined;
  }
}

export function buildFormat(sourceIds: Map<string, string>, warn: (message: string) => void) {
  return (loc: SourceLoc): string => {
    const location = formatLoc(loc);
    const hashId = hashLocation(location);
    const existing = sourceIds.get(hashId);
    if (existing === undefined) {
      sourceIds.set(hashId, location);
    } else if (existing !== location) {
      warn(`passback: source id collision ${hashId}`);
    }
    return hashId;
  };
}
