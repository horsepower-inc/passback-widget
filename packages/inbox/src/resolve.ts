// resolves chain hash ids to file:line:col through a build's manifest entries.

import type { Payload } from '@passback/schema';

type ChainEntry = Payload['code']['chain'][number];

/** Splits a manifest value `path:line:col` from the right; `undefined` when it doesn't fit that shape. */
function splitLocation(value: string): { path: string; line: number; col: number } | undefined {
  const colIdx = value.lastIndexOf(':');
  if (colIdx === -1) return undefined;
  const lineIdx = value.lastIndexOf(':', colIdx - 1);
  if (lineIdx === -1) return undefined;
  const path = value.slice(0, lineIdx);
  const line = Number(value.slice(lineIdx + 1, colIdx));
  const col = Number(value.slice(colIdx + 1));
  if (path === '' || !Number.isInteger(line) || line <= 0 || !Number.isInteger(col) || col <= 0) {
    return undefined;
  }
  return { path, line, col };
}

/** Resolves each hash-only chain entry to `file`/`line`/`col` via a build's manifest, when mapped. */
export function resolveChain(
  chain: Payload['code']['chain'],
  ids?: Readonly<Record<string, string>>,
): Payload['code']['chain'] {
  return chain.map((entry: ChainEntry): ChainEntry => {
    if (entry.file !== undefined || entry.hash === undefined) return entry;
    const raw = ids !== undefined && Object.hasOwn(ids, entry.hash) ? ids[entry.hash] : undefined;
    const location = typeof raw === 'string' ? splitLocation(raw) : undefined;
    if (!location) return entry;
    return { ...entry, file: location.path, line: location.line, col: location.col };
  });
}
