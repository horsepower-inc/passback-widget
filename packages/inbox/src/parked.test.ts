import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parsePayload } from '@passback/schema';
import { appendReply, applyVerdict, fromPayload, parse, render } from './index';
import { MARK_STATUSES } from './status';
import type { InboxFile } from './inbox-file';

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

/** Inserts a literal frontmatter line directly before the closing `---`. */
function withFrontmatterLine(text: string, line: string): string {
  return text.replace('\n---\n', `\n${line}\n---\n`);
}

describe('parked flag', () => {
  it('retains a parked flag through parse and render', () => {
    const orphaned = { ...base(), orphaned: true };
    for (const file of [base(), orphaned]) {
      const text = withFrontmatterLine(render(file), 'parked: true');
      const parsed = parse(text);
      expect(parsed.parked).toBe(true);
      const rendered = render(parsed);
      const lines = rendered.split('\n');
      expect(lines.filter((l) => l.startsWith('parked'))).toEqual(['parked: true']);
      const at = lines.indexOf('parked: true');
      expect(lines[at - 1]).toBe(
        file.orphaned ? 'orphaned: true' : `createdAt: "${meta.createdAt}"`,
      );
      expect(lines[at + 1]).toBe('---');
      expect(parse(rendered)).toEqual({ ...file, parked: true });
      expect(rendered).toBe(text);
    }
  });

  it('keeps legacy and unparked inbox output unchanged', () => {
    const file = base();
    const original = render(file);
    expect(file.parked).toBeUndefined();
    expect(original).not.toContain('parked');
    expect(render({ ...file, parked: false })).toBe(original);
    const text = withFrontmatterLine(original, 'parked: true');
    const unparked = { ...parse(text), parked: undefined };
    const cleared = render(unparked);
    expect(cleared).toBe(original);
    expect(parse(cleared).parked).toBeUndefined();
    expect(parse(withFrontmatterLine(original, 'parked: false')).parked).toBe(false);
  });

  it('parks independently of status and iteration history', () => {
    let history = appendReply(
      { ...base(), status: 'ack' },
      { at: '2026-09-19T14:05:00Z', text: 'changed gap' },
    );
    history = applyVerdict(history, {
      at: '2026-09-19T14:07:00Z',
      verdict: { kind: 'decline', reason: 'still off' },
    });
    history = appendReply(history, { at: '2026-09-19T14:11:00Z', text: 'added rule' });
    for (const status of MARK_STATUSES) {
      const file = { ...history, status };
      const parked = parse(render({ ...file, parked: true }));
      expect(parked).toEqual({ ...file, parked: true });
      const rest = { ...parked, parked: undefined };
      expect(rest).toEqual(file);
      expect(parked.iterations).toEqual(history.iterations);
    }
  });

  it('preserves existing parse errors when a parked flag is present', () => {
    const text = render(base());
    const missing = text.replace(/^route: .*\n/m, '');
    expect(() => parse(withFrontmatterLine(missing, 'parked: true'))).toThrow(
      'inbox file missing field: route',
    );
    const badVersion = text.replace('schemaVersion: 1', 'schemaVersion: 2');
    expect(() => parse(withFrontmatterLine(badVersion, 'parked: true'))).toThrow(
      'unsupported schemaVersion: 2',
    );
  });
});
