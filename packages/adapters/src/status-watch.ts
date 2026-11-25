// the polling status watcher behind onStatusChange (steps 2-8).

import { readFileSync } from 'node:fs';
import { parse } from '@passback/inbox';
import type { Unsubscribe } from './tracker-adapter';

/** Reads the status on disk right now; undefined when the read or the parse throws. */
export function readStatus(path: string): string | undefined {
  try {
    return parse(readFileSync(path, 'utf8')).status;
  } catch {
    return undefined;
  }
}

/** Polls `path` every `pollMs` and calls `cb` with each status distinct from the last one reported. */
export function watchStatus(
  path: string,
  pollMs: number,
  cb: (status: string) => void,
): Unsubscribe {
  let active = true;
  let last = readStatus(path);
  const listener = (): void => {
    if (!active) return;
    const status = readStatus(path);
    if (status === undefined || status === last) return;
    last = status;
    cb(status);
  };
  const timer = setInterval(listener, pollMs);
  return () => {
    if (!active) return;
    active = false;
    clearInterval(timer);
  };
}
