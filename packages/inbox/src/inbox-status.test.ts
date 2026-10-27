import { describe, expect, it } from 'vitest';
import { appendReply, applyVerdict, parse, render } from './index';
import type { InboxFile, IterationStatus } from './inbox-file';

const base: InboxFile = {
  id: '01J8ZKZ8J8ZKZ8J8ZKZ8J8ZKZ8',
  schemaVersion: 1,
  batchId: '01J8ZKZ8J8ZKZ8J8ZKZ8J8ZKZ9',
  status: 'ack',
  iteration: 1,
  route: '/p',
  selector: '#a',
  createdAt: '2026-09-19T14:00:00Z',
  comment: 'fix it',
  annotations: [],
  iterations: [],
};

const statuses: IterationStatus[] = [
  { state: 'running', at: '2026-09-19T14:03:00Z', message: 'looking\n"here" \\ ok' },
  { state: 'queued', at: '2026-09-19T14:01:00Z' },
  { state: 'running', at: '2026-09-19T14:03:00Z', message: 'looking\n"here" \\ ok' },
  { state: 'failed', at: '2026-09-19T14:02:00Z', message: 'boom' },
  { state: 'done', at: '2026-09-19T14:04:00Z', prUrl: 'https://github.com/a/b/pull/1' },
];

const legacy = `---
id: "01J8ZKZ8J8ZKZ8J8ZKZ8J8ZKZ8"
schemaVersion: 1
batchId: "01J8ZKZ8J8ZKZ8J8ZKZ8J8ZKZ9"
status: "proposed"
iteration: 1
route: "/p"
selector: "#a"
createdAt: "2026-09-19T14:00:00Z"
---
fix it

\`\`\`json annotations
[]
\`\`\`

## Iteration 1

**agent** 2026-09-19T14:05:00Z done
`;

/** The legacy file with `block` spliced in right after the iteration heading. */
const withBlock = (block: string) =>
  legacy.replace('## Iteration 1\n', `## Iteration 1\n\n${block}\n`);
const goodEntry = '{"state":"queued","at":"2026-09-19T14:01:00Z"}';

describe('inbox status history', () => {
  it('round-trips ordered status history without changing replies or verdicts', () => {
    const file: InboxFile = {
      ...base,
      status: 'ack',
      iterations: [{ n: 1, statuses }],
    };
    const replied = appendReply(file, { at: '2026-09-19T14:05:00Z', text: 'changed gap' });
    expect(replied.iterations[0]!.statuses).toEqual(statuses);
    const decided = applyVerdict(replied, {
      at: '2026-09-19T14:06:00Z',
      verdict: { kind: 'decline', reason: 'still off' },
    });
    expect(decided.iterations[0]!.statuses).toEqual(statuses);

    const multi: InboxFile = {
      ...decided,
      iterations: [...decided.iterations, { n: 2, statuses: statuses.slice(0, 2) }],
    };
    const text = render(multi);
    expect(parse(text)).toEqual(multi);
    expect(text).toContain(
      `## Iteration 1\n\n**statuses** ${JSON.stringify(statuses)}\n\n**agent** `,
    );
    expect(render(parse(text))).toBe(text);
  });

  it('preserves absent and explicitly empty status history', () => {
    const parsed = parse(legacy);
    expect(parsed.iterations).toEqual([
      { n: 1, agent: { at: '2026-09-19T14:05:00Z', text: 'done' } },
    ]);
    expect('statuses' in parsed.iterations[0]!).toBe(false);
    expect(render(parsed)).toBe(legacy);

    const empty = parse(withBlock('**statuses** []'));
    expect(empty.iterations[0]!.statuses).toEqual([]);
    expect(render(empty)).toBe(withBlock('**statuses** []'));
  });

  it('keeps status markers inside legacy free text', () => {
    const marker = `**statuses** ${JSON.stringify(statuses)}`;
    const file: InboxFile = {
      ...base,
      status: 'proposed',
      comment: `first\n${marker}\nlast`,
      iterations: [
        {
          n: 1,
          agent: { at: '2026-09-19T14:05:00Z', text: `line one\n${marker}\n**statuses** []` },
          human: { at: '2026-09-19T14:06:00Z', verdict: { kind: 'comment', text: `x\n${marker}` } },
        },
      ],
    };
    const parsed = parse(render(file));
    expect(parsed).toEqual(file);
    expect('statuses' in parsed.iterations[0]!).toBe(false);
  });

  it('rejects malformed and misplaced status blocks', () => {
    const bad = [
      '**statuses** {not json',
      '**statuses** {"state":"queued","at":"2026-09-19T14:01:00Z"}',
      '**statuses** "queued"',
      '**statuses** [null]',
      '**statuses** [{"state":"queued"}]',
      '**statuses** [{"at":"2026-09-19T14:01:00Z"}]',
      '**statuses** [{"state":"pending","at":"2026-09-19T14:01:00Z"}]',
      '**statuses** [{"state":"queued","at":"yesterday"}]',
      '**statuses** [{"state":"done","at":"2026-09-19T14:01:00Z","prUrl":"not a url"}]',
      '**statuses** [{"state":"queued","at":"2026-09-19T14:01:00Z","message":3}]',
      '**statuses** [{"state":"queued","at":"2026-09-19T14:01:00Z","markId":"x"}]',
      `**statuses** [${goodEntry}]\n\n**statuses** []`,
    ];
    for (const block of bad) expect(() => parse(withBlock(block)), block).toThrow();

    const beforeHeading = legacy.replace(
      '## Iteration 1',
      `**statuses** [${goodEntry}]\n\n## Iteration 1`,
    );
    expect(() => parse(beforeHeading)).toThrow();
  });

  it('allows status-only iterations without enabling a human verdict', () => {
    const only = withBlock(`**statuses** [${goodEntry}]`).replace(/\n\*\*agent\*\*.*\n$/s, '');
    const parsed = parse(only);
    expect(parsed.iterations).toEqual([
      { n: 1, statuses: [{ state: 'queued', at: '2026-09-19T14:01:00Z' }] },
    ]);
    expect(parsed.iterations[0]!.agent).toBeUndefined();
    expect(parse(render(parsed))).toEqual(parsed);

    const withHuman = `${only}\n**human** 2026-09-19T14:06:00Z accept\n`;
    expect(() => parse(withHuman)).toThrow(/before the \*\*agent\*\* reply/);
    expect(() =>
      applyVerdict(
        { ...parsed, status: 'proposed' },
        { at: '2026-09-19T14:06:00Z', verdict: { kind: 'accept' } },
      ),
    ).toThrow(/before the agent has replied/);
  });
});
