// 8-char hash ids for data-source in production builds.

import { createHash } from 'node:crypto';

export function hashLocation(loc: string): string {
  return createHash('sha256').update(loc).digest('hex').slice(0, 8);
}
