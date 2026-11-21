// reads one build id's hash-to-location map written by the
// vite-plugin's local manifest, so `passback_wait` can resolve hashed chains for staging builds.

import { readFile } from 'node:fs/promises';
import path from 'node:path';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** One build id's hash-to-location map from `<root>/.passback/manifest.json`, or `undefined`. */
export async function readManifestIds(
  root: string,
  buildId: string | undefined,
): Promise<Readonly<Record<string, string>> | undefined> {
  if (buildId === undefined) return undefined;

  let manifest: unknown;
  try {
    const raw = await readFile(path.join(root, '.passback', 'manifest.json'), 'utf8');
    manifest = JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }

  if (!isPlainObject(manifest) || !Object.hasOwn(manifest, buildId)) return undefined;

  const entry = manifest[buildId];
  if (!isPlainObject(entry)) return undefined;

  const ids: Record<string, string> = {};
  for (const [hash, location] of Object.entries(entry)) {
    if (typeof location === 'string') ids[hash] = location;
  }
  return ids;
}
