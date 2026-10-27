import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parsePayload } from '@passback/schema';
import { appendReply, applyVerdict, fromPayload, parse, render, transition } from './index';

const payloadFile = fileURLToPath(
  new URL('../../../fixtures/payloads/react-component-chain.json', import.meta.url),
);
const payload = parsePayload(JSON.parse(readFileSync(payloadFile, 'utf8')));

const meta = {
  id: '01J8ZKZ8J8ZKZ8J8ZKZ8J8ZKZ8',
  batchId: '01J8ZKZ8J8ZKZ8J8ZKZ8J8ZKZ9',
  createdAt: '2026-09-19T14:00:00Z',
};

const AGENT_LINE = '**agent** 2026-09-19T14:05:00Z fixed the gap';
const HUMAN_LINE = '**human** 2026-09-19T14:07:00Z decline: still off';
const SWAP_PLACEHOLDER = '\u0000SWAP\u0000';

/** Iteration 1: an agent reply followed by a declining verdict; iteration 2 opened but not replied to yet. */
function buildOneRoundFile() {
  let file = fromPayload(payload, meta);
  file = { ...file, status: transition(file.status, 'ack', 'agent') };
  file = appendReply(file, { at: '2026-09-19T14:05:00Z', text: 'fixed the gap' });
  file = applyVerdict(file, {
    at: '2026-09-19T14:07:00Z',
    verdict: { kind: 'decline', reason: 'still off' },
  });
  return file;
}

describe('parse, strict iterations', () => {
  it('rejects duplicate iteration headings', () => {
    let file = buildOneRoundFile();
    file = appendReply(file, { at: '2026-09-19T14:11:00Z', text: 'added a breakpoint rule' });
    const text = render(file).replace('## Iteration 2', '## Iteration 1');
    expect(() => parse(text)).toThrow(/duplicate iteration heading: 1/);
  });

  it('rejects an iteration heading out of order', () => {
    let file = buildOneRoundFile();
    file = appendReply(file, { at: '2026-09-19T14:11:00Z', text: 'added a breakpoint rule' });
    const text = render(file).replace('## Iteration 2', '## Iteration 3');
    expect(() => parse(text)).toThrow(/iteration heading 3 out of order: expected 2/);
  });

  it('rejects a first iteration numbered above 1', () => {
    const file = buildOneRoundFile();
    const text = render(file).replace('## Iteration 1', '## Iteration 2');
    expect(() => parse(text)).toThrow(/iteration heading 2 out of order: expected 1/);
  });

  it('rejects a verdict before the agent reply', () => {
    const file = buildOneRoundFile();
    const text = render(file)
      .replace(AGENT_LINE, SWAP_PLACEHOLDER)
      .replace(HUMAN_LINE, AGENT_LINE)
      .replace(SWAP_PLACEHOLDER, HUMAN_LINE);
    expect(() => parse(text)).toThrow(
      /iteration 1 has a \*\*human\*\* verdict before the \*\*agent\*\* reply/,
    );
  });

  it('rejects an iteration holding only a verdict', () => {
    const file = buildOneRoundFile();
    const text = render(file).replace(`\n\n${AGENT_LINE}\n\n`, '\n\n');
    expect(() => parse(text)).toThrow(
      /iteration 1 has a \*\*human\*\* verdict before the \*\*agent\*\* reply/,
    );
  });

  it('still parses a rendered file with a declined first iteration and a second reply', () => {
    let file = buildOneRoundFile();
    file = appendReply(file, { at: '2026-09-19T14:11:00Z', text: 'added a breakpoint rule' });
    expect(parse(render(file))).toEqual(file);
  });
});
