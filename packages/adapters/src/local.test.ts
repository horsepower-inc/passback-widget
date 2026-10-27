import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as local from './local';

const here = dirname(fileURLToPath(import.meta.url));

const LOCAL_FILES = [
  'accept-mark.ts',
  'accept-orphaned.ts',
  'accept-reopen.ts',
  'agent-session.ts',
  'accept-verdict.ts',
  'archive-done.ts',
  'clear-inbox.ts',
  'file-inbox-adapter.ts',
  'github-review-post.ts',
  'github-review.ts',
  'list-inbox.ts',
  'local.ts',
  'outbox-relay.ts',
  'pr-diff-lines.ts',
  'status-watch.ts',
  'tracker-adapter.ts',
  'ulid.ts',
];

function reached(entry: string): string[] {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(join(here, file), 'utf8');
    const re = /(?:\bfrom\s*|\bimport\s*\(\s*)['"]\.\/([^'"]+)['"]/g;
    for (const m of source.matchAll(re)) {
      const name = m[1] as string;
      queue.push(name.endsWith('.ts') ? name : `${name}.ts`);
    }
  }
  return [...seen].sort();
}

describe('@passback/adapters/local', () => {
  it('exports exactly the local names', () => {
    expect(Object.keys(local).sort()).toEqual([
      'FileInboxAdapter',
      'acceptMark',
      'acceptOrphaned',
      'acceptReopen',
      'acceptVerdict',
      'archiveDone',
      'clearInbox',
      'commentableLines',
      'drainOutbox',
      'isOpenMark',
      'listInbox',
      'markMarker',
      'postPrReview',
      'readAgentSession',
      'renderPrReview',
      'startOutboxRelay',
      'watchAgentSession',
    ]);
  });

  it('reaches only the local source files', () => {
    expect(reached('local.ts')).toEqual([...LOCAL_FILES].sort());
  });
});
