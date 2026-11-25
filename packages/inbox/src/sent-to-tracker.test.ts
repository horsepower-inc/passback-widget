import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parsePayload } from '@passback/schema';
import { appendReply, fromPayload, markSentToTracker, parse, render } from './index';
import type { InboxFile, SentToTracker } from './inbox-file';

const dir = fileURLToPath(new URL('../../../fixtures/payloads/', import.meta.url));
const payloads = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => parsePayload(JSON.parse(readFileSync(dir + f, 'utf8'))));

const meta = {
  id: '01J8ZKZ8J8ZKZ8J8ZKZ8J8ZKZ8',
  batchId: '01J8ZKZ8J8ZKZ8J8ZKZ8J8ZKZ9',
  createdAt: '2026-09-19T14:00:00Z',
};

const base = (): InboxFile => fromPayload(payloads[0]!, meta);

const withUrl: SentToTracker = { tracker: 'linear', ref: 'ISSUE-42', url: 'https://x.test/ISSUE-42' };
const noUrl: SentToTracker = { tracker: 'linear', ref: 'ISSUE-42' };

/** Inserts a literal frontmatter line directly before the closing `---`. */
function withFrontmatterLine(text: string, line: string): string {
  return text.replace('\n---\n', `\n${line}\n---\n`);
}

describe('sent to tracker', () => {
  it('retains the tracker and the issue reference through parse and render', () => {
    for (const sent of [withUrl, noUrl]) {
      for (const parked of [false, true]) {
        const file = { ...base(), ...(parked ? { parked: true } : {}), sentToTracker: sent };
        const text = render(file);
        const lines = text.split('\n');
        expect(lines.filter((l) => l.startsWith('sentToTracker'))).toHaveLength(1);
        const at = lines.findIndex((l) => l.startsWith('sentToTracker: '));
        expect(lines[at]).toBe(`sentToTracker: ${JSON.stringify(sent)}`);
        expect(lines[at - 1]).toBe(parked ? 'parked: true' : `createdAt: "${meta.createdAt}"`);
        expect(lines[at + 1]).toBe('---');
        const parsed = parse(text);
        expect(parsed).toEqual(file);
        expect(parsed.sentToTracker).toEqual(sent);
        expect(render(parsed)).toBe(text);
      }
    }
  });

  it('keeps files without a sent-to-tracker field byte for byte', () => {
    const file = base();
    const legacy = render(file);
    expect(legacy).not.toContain('sentToTracker');
    const parsed = parse(legacy);
    expect('sentToTracker' in parsed).toBe(false);
    expect(render(parsed)).toBe(legacy);
    expect(render({ ...file, sentToTracker: undefined })).toBe(legacy);

    const parkedOnly = parse(render({ ...file, parked: true }));
    expect(parkedOnly.parked).toBe(true);
    expect(parkedOnly.sentToTracker).toBeUndefined();
    const sentOnly = parse(render({ ...file, sentToTracker: noUrl }));
    expect(sentOnly.parked).toBeUndefined();
    expect(sentOnly.sentToTracker).toEqual(noUrl);
    const both = parse(render({ ...file, parked: true, sentToTracker: noUrl }));
    expect(both.parked).toBe(true);
    expect(both.sentToTracker).toEqual(noUrl);
  });

  it('sets the field with markSentToTracker without changing anything else and replaces an earlier value', () => {
    const history = appendReply(
      { ...base(), status: 'ack', orphaned: true, parked: true },
      { at: '2026-09-19T14:05:00Z', text: 'changed gap' },
    );
    const marked = markSentToTracker(history, withUrl);
    expect(marked).toEqual({ ...history, sentToTracker: withUrl });
    expect(marked.status).toBe('proposed');
    expect(marked.iterations).toEqual(history.iterations);
    expect(marked.parked).toBe(true);
    expect(marked.orphaned).toBe(true);
    expect(history.sentToTracker).toBeUndefined();

    const replaced = markSentToTracker(marked, { tracker: 'jira', ref: 'K-1' });
    expect(replaced.sentToTracker).toEqual({ tracker: 'jira', ref: 'K-1' });
    expect('url' in replaced.sentToTracker!).toBe(false);

    const extra = { ...noUrl, extra: 1 } as SentToTracker;
    expect(markSentToTracker(base(), extra).sentToTracker).toEqual(noUrl);
    expect(Object.keys(markSentToTracker(base(), extra).sentToTracker!)).toEqual([
      'tracker',
      'ref',
    ]);
  });

  it('rejects a malformed sent-to-tracker line', () => {
    const text = render(base());
    const bad = [
      'sentToTracker: {nope',
      'sentToTracker: []',
      'sentToTracker: "linear"',
      'sentToTracker: null',
      'sentToTracker: {"tracker":"","ref":"ISSUE-1"}',
      'sentToTracker: {"tracker":"linear"}',
      'sentToTracker: {"tracker":"linear","ref":"ISSUE-1","url":5}',
      'sentToTracker: {"tracker":"linear","ref":"ISSUE-1","extra":"x"}',
    ];
    for (const line of bad) {
      expect(() => parse(withFrontmatterLine(text, line))).toThrow(/sentToTracker/);
    }
  });
});
