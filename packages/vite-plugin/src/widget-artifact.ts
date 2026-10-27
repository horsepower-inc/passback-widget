// finds the prebuilt widget files, first next to this module
// (an installed plugin ships them in `widget/`), then in the workspace `@passback/widget` package.

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export type WidgetFile =
  'passback.js' | 'passback-local.js' | 'passback-collect.js' | 'passback-shot.js';

function guidance(problem: string, specifier: string): never {
  throw new Error(
    `passback: ${problem} (${specifier}). Run \`pnpm --filter @passback/widget build\` and retry.`,
  );
}

function readAdjacent(
  file: WidgetFile,
  from: string | URL,
): { path: string; bytes: Buffer } | null {
  try {
    const url = new URL('./widget/' + file, from);
    const bytes = readFileSync(url);
    if (bytes.byteLength === 0) return null;
    return { path: fileURLToPath(url), bytes };
  } catch {
    return null;
  }
}

/** Reads `widget/<file>` next to `from`; when that is missing or empty, resolves
 * `@passback/widget/dist/<file>` from this package's dependency graph and reads it. Every call
 * re-reads from disk, never evaluating the bytes. */
export function readWidgetFile(
  file: WidgetFile,
  from: string | URL = import.meta.url,
): { path: string; bytes: Buffer } {
  const adjacent = readAdjacent(file, from);
  if (adjacent) return adjacent;

  const specifier = `@passback/widget/dist/${file}`;
  const require = createRequire(import.meta.url);
  let path: string;
  try {
    path = require.resolve(specifier);
  } catch {
    return guidance('cannot find the widget artifact', specifier);
  }
  let bytes: Buffer;
  try {
    bytes = readFileSync(path);
  } catch {
    return guidance('cannot read the widget artifact', specifier);
  }
  if (bytes.byteLength === 0) {
    return guidance('found an empty widget artifact', specifier);
  }
  return { path, bytes };
}
