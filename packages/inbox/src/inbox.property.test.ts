import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parsePayload } from '@passback/schema';
import { appendReply, applyVerdict, fromPayload, parse, render, transition } from './index';
import type { InboxFile, Verdict } from './inbox-file';

const dir = fileURLToPath(new URL('../../../fixtures/payloads/', import.meta.url));
const payloads = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => parsePayload(JSON.parse(readFileSync(dir + f, 'utf8'))));

const meta = {
  id: '01J8ZKZ8J8ZKZ8J8ZKZ8J8ZKZ8',
  batchId: '01J8ZKZ8J8ZKZ8J8ZKZ8J8ZKZ9',
  createdAt: '2026-09-19T14:00:00Z',
};

const freeText = fc
  .array(
    fc.oneof(
      fc.string({ unit: 'binary' }),
      fc.constantFrom(
        '## Iteration 2',
        '**agent** x',
        '**human** y',
        'Wireframe: z',
        '```',
        '\\',
        '---',
        '',
        '\r',
        String.fromCharCode(0x2028),
        String.fromCharCode(0x2029),
      ),
    ),
    { maxLength: 8 },
  )
  .map((lines) => lines.join('\n'));

const isoAt = fc
  .date({
    min: new Date('2000-01-01T00:00:00Z'),
    max: new Date('2099-12-31T23:59:59Z'),
    noInvalidDate: true,
  })
  .map((d) => d.toISOString());

const declineOrComment: fc.Arbitrary<Verdict> = fc.oneof(
  freeText.map((reason): Verdict => ({ kind: 'decline', reason })),
  freeText.map((text): Verdict => ({ kind: 'comment', text })),
);

const lastVerdict: fc.Arbitrary<Verdict | undefined> = fc.oneof(
  declineOrComment,
  fc.constant<Verdict>({ kind: 'accept' }),
  fc.constant(undefined),
);

type Round = { replyAt: string; reply: string; verdictAt: string; verdict: Verdict | undefined };

const middleRound = fc.record({
  replyAt: isoAt,
  reply: freeText,
  verdictAt: isoAt,
  verdict: declineOrComment,
});
const finalRound = fc.record({
  replyAt: isoAt,
  reply: freeText,
  verdictAt: isoAt,
  verdict: lastVerdict,
});

const rounds: fc.Arbitrary<Round[]> = fc.integer({ min: 0, max: 4 }).chain((n) => {
  if (n === 0) return fc.constant<Round[]>([]);
  return fc
    .tuple(fc.array(middleRound, { minLength: n - 1, maxLength: n - 1 }), finalRound)
    .map(([prefix, last]) => [...prefix, last]);
});

function applyRounds(file: InboxFile, rs: Round[]): InboxFile {
  let current = file;
  for (const round of rs) {
    if (current.status === 'new') {
      current = { ...current, status: transition(current.status, 'ack', 'agent') };
    }
    current = appendReply(current, { at: round.replyAt, text: round.reply });
    if (round.verdict) {
      current = applyVerdict(current, { at: round.verdictAt, verdict: round.verdict });
    }
  }
  return current;
}

describe('inbox properties', () => {
  it('parse inverts render for any comment text', () => {
    fc.assert(
      fc.property(fc.constantFrom(...payloads), freeText, (payload, comment) => {
        const file = fromPayload({ ...payload, intent: { ...payload.intent, comment } }, meta);
        expect(parse(render(file))).toEqual(file);
      }),
      { numRuns: 200 },
    );
  });

  it('parse inverts render for any route, selector and build id', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...payloads),
        freeText,
        freeText,
        freeText,
        (payload, route, selector, buildId) => {
          const file = fromPayload(
            {
              ...payload,
              runtime: { ...payload.runtime, route },
              element: { ...payload.element, selectors: [{ kind: 'css', value: selector }] },
              code: { ...payload.code, buildId },
            },
            meta,
          );
          expect(parse(render(file))).toEqual(file);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('parse inverts render for any sequence of replies and verdicts', () => {
    fc.assert(
      fc.property(fc.constantFrom(...payloads), rounds, (payload, rs) => {
        const file = applyRounds(fromPayload(payload, meta), rs);
        expect(parse(render(file))).toEqual(file);
      }),
      { numRuns: 200 },
    );
  });

  it('numbers iterations 1 to n after n minus 1 declines or comments', () => {
    fc.assert(
      fc.property(fc.constantFrom(...payloads), rounds, (payload, rs) => {
        const file = applyRounds(fromPayload(payload, meta), rs);
        const declinesOrComments = rs.filter(
          (r) => r.verdict?.kind === 'decline' || r.verdict?.kind === 'comment',
        ).length;
        expect(file.iterations.map((it) => it.n)).toEqual(
          Array.from({ length: file.iterations.length }, (_, i) => i + 1),
        );
        expect(file.iteration).toBe(declinesOrComments + 1);
      }),
      { numRuns: 200 },
    );
  });

  it('parses a route holding U+2028 and U+2029', () => {
    const payload = payloads[0]!;
    const file = fromPayload(
      { ...payload, runtime: { ...payload.runtime, route: '/a b c' } },
      meta,
    );
    expect(parse(render(file))).toEqual(file);
  });
});
