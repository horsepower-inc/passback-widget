import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parsePayload } from '@passback/schema';
import {
  appendReply,
  applyVerdict,
  fromPayload,
  MARK_STATUSES,
  parse,
  render,
  transition,
} from './index';

const dir = fileURLToPath(new URL('../../../fixtures/payloads/', import.meta.url));
const payloads = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => ({ name: f, payload: parsePayload(JSON.parse(readFileSync(dir + f, 'utf8'))) }));

const meta = {
  id: '01J8ZKZ8J8ZKZ8J8ZKZ8J8ZKZ8',
  batchId: '01J8ZKZ8J8ZKZ8J8ZKZ8J8ZKZ9',
  createdAt: '2026-09-19T14:00:00Z',
};

describe('inbox file', () => {
  it('round-trip', () => {
    expect(payloads.length).toBeGreaterThanOrEqual(4);
    for (const { name, payload } of payloads) {
      const file = fromPayload(payload, meta);
      expect(parse(render(file)), name).toEqual(file);
    }
  });

  it('round-trip with iterations', () => {
    let file = fromPayload(payloads[0]!.payload, meta);
    file = { ...file, status: transition(file.status, 'ack', 'agent') };
    file = appendReply(file, { at: '2026-09-19T14:05:00Z', text: 'changed gap from 12 to 16' });
    file = applyVerdict(file, {
      at: '2026-09-19T14:07:00Z',
      verdict: { kind: 'decline', reason: 'still 2px off' },
    });
    file = appendReply(file, { at: '2026-09-19T14:11:00Z', text: 'added a breakpoint rule' });
    expect(parse(render(file))).toEqual(file);
  });

  it('illegal transition throws', () => {
    expect(() => transition('proposed', 'new', 'agent')).toThrow();
    expect(() => transition('new', 'accepted', 'human')).toThrow();
  });

  it('accepted requires human', () => {
    expect(() => transition('proposed', 'accepted', 'agent')).toThrow();
    expect(transition('proposed', 'accepted', 'human')).toBe('accepted');
  });

  it('decline opens the next iteration', () => {
    let file = fromPayload(payloads[0]!.payload, meta);
    file = { ...file, status: transition(file.status, 'ack', 'agent') };
    file = appendReply(file, { at: '2026-09-19T14:05:00Z', text: 'changed gap from 12 to 16' });
    const next = applyVerdict(file, {
      at: '2026-09-19T14:07:00Z',
      verdict: { kind: 'decline', reason: 'still 2px off' },
    });
    expect(next.iteration).toBe(2);
    expect(next.status).toBe('ack');
  });

  it('parses the CONTRACTS §2 example layout', () => {
    const text = [
      '---',
      'id: 01J8Z8Z8Z8Z8Z8Z8Z8Z8Z8Z8Z8',
      'schemaVersion: 1',
      'batchId: 01J8Z8Z8Z8Z8Z8Z8Z8Z8Z8Z8Z9',
      'category: visual',
      'status: proposed',
      'iteration: 2',
      'route: /products/:id',
      'selector: "[data-testid=price]"',
      'file: src/components/PriceTag.tsx:14:7',
      'buildId: 3f2a9c1',
      'createdAt: 2026-09-19T14:00:00Z',
      '---',
      '<comment>',
      '',
      '```json annotations',
      '[]',
      '```',
      'Wireframe: ./01J8Z8Z8Z8Z8Z8Z8Z8Z8Z8Z8Z8/wireframe.svg',
      '',
      '## Iteration 1',
      '',
      '**agent** 2026-09-19T14:05:00Z changed `gap` from 12 to 16 in `src/components/PriceTag.tsx:14`',
      '',
      '**human** 2026-09-19T14:07:00Z decline: still 2 px off at 375 px wide',
      '',
      '## Iteration 2',
      '',
      '**agent** 2026-09-19T14:11:00Z added a 375 px breakpoint rule in `src/components/PriceTag.tsx:22`',
      '',
    ].join('\n');

    const file = parse(text);
    expect(file.id).toBe('01J8Z8Z8Z8Z8Z8Z8Z8Z8Z8Z8Z8');
    expect(file.batchId).toBe('01J8Z8Z8Z8Z8Z8Z8Z8Z8Z8Z8Z9');
    expect(file.category).toBe('visual');
    expect(file.status).toBe('proposed');
    expect(file.iteration).toBe(2);
    expect(file.route).toBe('/products/:id');
    expect(file.selector).toBe('[data-testid=price]');
    expect(file.file).toBe('src/components/PriceTag.tsx:14:7');
    expect(file.buildId).toBe('3f2a9c1');
    expect(file.createdAt).toBe('2026-09-19T14:00:00Z');
    expect(file.comment).toBe('<comment>');
    expect(file.iterations).toHaveLength(2);
    expect(file.iterations[1]!.agent?.text).toBe(
      'added a 375 px breakpoint rule in `src/components/PriceTag.tsx:22`',
    );
  });

  it('round-trips multi-line replies and text that contains a delimiter', () => {
    let file = fromPayload(payloads[0]!.payload, meta);
    file = { ...file, status: transition(file.status, 'ack', 'agent') };
    file = appendReply(file, {
      at: '2026-09-19T14:05:00Z',
      text: 'first line\n**human** this looks like a delimiter but is not one\nthird line',
    });
    file = applyVerdict(file, {
      at: '2026-09-19T14:07:00Z',
      verdict: {
        kind: 'decline',
        reason: 'still off\n## Iteration 99 this looks like a header but is not one',
      },
    });
    expect(parse(render(file))).toEqual(file);
  });

  it('withdraw from every status', () => {
    for (const status of MARK_STATUSES) {
      if (status === 'withdrawn') continue;
      expect(transition(status, 'withdrawn', 'human')).toBe('withdrawn');
    }
    expect(() => transition('withdrawn', 'withdrawn', 'human')).toThrow();
  });

  it('round-trips multi-paragraph replies', () => {
    let file = fromPayload(payloads[0]!.payload, meta);
    file = { ...file, status: transition(file.status, 'ack', 'agent') };
    file = appendReply(file, {
      at: '2026-09-19T14:05:00Z',
      text: 'changed the gap token.\n\nIt was 12px, now 16px, matching the design spec.',
    });
    file = applyVerdict(file, {
      at: '2026-09-19T14:07:00Z',
      verdict: {
        kind: 'comment',
        text: 'Looks closer.\n\nCan you also check the 375px breakpoint?',
      },
    });
    expect(parse(render(file))).toEqual(file);
  });

  it('round-trips text that already starts with a backslash-escaped delimiter', () => {
    let file = fromPayload(payloads[0]!.payload, meta);
    file = { ...file, status: transition(file.status, 'ack', 'agent') };
    file = appendReply(file, {
      at: '2026-09-19T14:05:00Z',
      text: 'changed the gap token.\n\\**human** this line already starts with a backslash escape',
    });
    file = applyVerdict(file, {
      at: '2026-09-19T14:07:00Z',
      verdict: { kind: 'decline', reason: 'still 2px off' },
    });
    expect(parse(render(file))).toEqual(file);
  });

  it('round-trips a comment that contains an annotations fence and a Wireframe line', () => {
    const payload = payloads[0]!.payload;
    const comment = '```json annotations\n[]\n```\nWireframe: ./x/y.svg';
    const file = fromPayload({ ...payload, intent: { ...payload.intent, comment } }, meta);
    expect(parse(render(file))).toEqual(file);
  });

  it('round-trips an empty comment', () => {
    const payload = payloads[0]!.payload;
    const file = fromPayload({ ...payload, intent: { ...payload.intent, comment: '' } }, meta);
    expect(parse(render(file))).toEqual(file);
  });

  it('round-trips a comment with leading blank lines', () => {
    const payload = payloads[0]!.payload;
    const comment = '\n\nStill broken after the fix.';
    const file = fromPayload({ ...payload, intent: { ...payload.intent, comment } }, meta);
    expect(parse(render(file))).toEqual(file);
  });

  it('renders no Wireframe line when the mark has no wireframe', () => {
    const file = fromPayload(payloads[0]!.payload, meta);
    const text = render(file);
    expect(text).not.toContain('Wireframe:');
    expect(parse(text)).not.toHaveProperty('wireframe');
  });

  it('round-trips a mark that names a wireframe', () => {
    const file = { ...fromPayload(payloads[0]!.payload, meta), wireframe: true as const };
    const text = render(file);
    expect(text).toContain(`\`\`\`\nWireframe: ./${meta.id}/wireframe.svg\n`);
    expect(parse(text)).toEqual(file);
  });

  it('renders as plain markdown', () => {
    let file = fromPayload(payloads[0]!.payload, meta);
    file = { ...file, status: transition(file.status, 'ack', 'agent') };
    file = appendReply(file, {
      at: '2026-09-19T14:05:00Z',
      text: 'changed `gap` from 12 to 16 in `src/components/PriceTag.tsx:14`',
    });
    file = applyVerdict(file, {
      at: '2026-09-19T14:07:00Z',
      verdict: { kind: 'decline', reason: 'still 2 px off at 375 px wide' },
    });
    file = appendReply(file, {
      at: '2026-09-19T14:11:00Z',
      text: 'added a 375 px breakpoint rule in `src/components/PriceTag.tsx:22`',
    });
    expect(render(file)).toMatchSnapshot();
  });
});
