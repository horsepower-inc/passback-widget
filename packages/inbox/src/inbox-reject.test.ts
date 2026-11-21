import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Payload } from '@passback/schema';
import { parsePayload } from '@passback/schema';
import { appendReply, applyVerdict, fromPayload, parse, render, transition } from './index';

const dir = fileURLToPath(new URL('../../../fixtures/payloads/', import.meta.url));
const payloads = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => ({ name: f, payload: parsePayload(JSON.parse(readFileSync(dir + f, 'utf8'))) }));

const meta = {
  id: '01J8ZKZ8J8ZKZ8J8ZKZ8J8ZKZ8',
  batchId: '01J8ZKZ8J8ZKZ8J8ZKZ8J8ZKZ9',
  createdAt: '2026-09-19T14:00:00Z',
};

function omit<T extends object, K extends keyof T>(obj: T, key: K): Omit<T, K> {
  const copy = { ...obj };
  delete copy[key];
  return copy;
}

const payload0 = payloads[0]!.payload;
const payloadWithoutCategory = {
  ...payload0,
  intent: omit(payload0.intent, 'category'),
} as unknown as Payload;
const payloadWithoutBuildId = {
  ...payload0,
  code: omit(payload0.code, 'buildId'),
} as unknown as Payload;
const payloadWithoutBoth = {
  ...payload0,
  intent: omit(payload0.intent, 'category'),
  code: omit(payload0.code, 'buildId'),
} as unknown as Payload;

describe('inbox file: rejections and optional lines', () => {
  it('rejects a verdict before a reply or on a closed mark', () => {
    const at = '2026-09-19T14:07:00Z';
    let file = fromPayload(payloads[0]!.payload, meta);
    expect(() => applyVerdict(file, { at, verdict: { kind: 'accept' } })).toThrow();

    file = { ...file, status: transition(file.status, 'ack', 'agent') };
    file = appendReply(file, { at: '2026-09-19T14:05:00Z', text: 'fixed it' });
    file = applyVerdict(file, { at, verdict: { kind: 'accept' } });
    expect(file.status).toBe('accepted');
    expect(() => applyVerdict(file, { at, verdict: { kind: 'accept' } })).toThrow();
  });

  it('rejects a missing or unsupported schemaVersion', () => {
    const file = fromPayload(payloads[0]!.payload, meta);
    const rendered = render(file);
    expect(() => parse(rendered.replace('schemaVersion: 1\n', ''))).toThrow();
    expect(() => parse(rendered.replace('schemaVersion: 1', 'schemaVersion: 2'))).toThrow();
  });

  it('rejects a malformed iteration', () => {
    const file = fromPayload(payloads[0]!.payload, meta);
    const rendered = render(file);
    for (const bad of ['banana', '0', '-1']) {
      expect(() => parse(rendered.replace('iteration: 1', `iteration: ${bad}`))).toThrow();
    }

    let withReply = { ...file, status: transition(file.status, 'ack', 'agent') };
    withReply = appendReply(withReply, { at: '2026-09-19T14:05:00Z', text: 'fixed it' });
    const renderedWithReply = render(withReply);
    for (const bad of ['banana', '0', '-1']) {
      expect(() =>
        parse(renderedWithReply.replace('## Iteration 1', `## Iteration ${bad}`)),
      ).toThrow();
    }
  });

  it('rejects a duplicate reply or verdict in one iteration', () => {
    const file = fromPayload(payloads[0]!.payload, meta);
    let withReply = { ...file, status: transition(file.status, 'ack', 'agent') };
    withReply = appendReply(withReply, { at: '2026-09-19T14:05:00Z', text: 'fixed it' });
    const rendered = render(withReply);

    const duplicateAgent = rendered.replace(
      '**agent** 2026-09-19T14:05:00Z fixed it',
      '**agent** 2026-09-19T14:05:00Z fixed it\n\n**agent** 2026-09-19T14:06:00Z fixed it again',
    );
    expect(() => parse(duplicateAgent)).toThrow();

    const withVerdict = applyVerdict(withReply, {
      at: '2026-09-19T14:07:00Z',
      verdict: { kind: 'comment', text: 'looks close' },
    });
    const renderedWithVerdict = render(withVerdict);
    const duplicateHuman = renderedWithVerdict.replace(
      '**human** 2026-09-19T14:07:00Z comment: looks close',
      '**human** 2026-09-19T14:07:00Z comment: looks close\n\n**human** 2026-09-19T14:08:00Z accept',
    );
    expect(() => parse(duplicateHuman)).toThrow();
  });

  it('rejects malformed annotations', () => {
    const file = fromPayload(payloads[0]!.payload, meta);
    const rendered = render(file);
    const withAnnotations = (json: string) =>
      rendered.replace('```json annotations\n[]', `\`\`\`json annotations\n${json}`);

    expect(() => parse(withAnnotations('null'))).toThrow();
    expect(() => parse(withAnnotations('{}'))).toThrow();
    expect(() => parse(withAnnotations('[{"type":"bogus"}]'))).toThrow();
  });

  it('omits the category line when the mark has no category', () => {
    const file = fromPayload(payloadWithoutCategory, meta);
    expect(file.category).toBeUndefined();
    expect(render(file)).not.toContain('category:');
  });

  it('omits the buildId line when the mark has no build id', () => {
    const file = fromPayload(payloadWithoutBuildId, meta);
    expect(file.buildId).toBeUndefined();
    expect(render(file)).not.toContain('buildId:');
  });

  it('parses a file without category and buildId lines', () => {
    const file = parse(render(fromPayload(payloadWithoutBoth, meta)));
    expect(file.category).toBeUndefined();
    expect(file.buildId).toBeUndefined();
  });

  it('round-trips a file without category and buildId', () => {
    const file = fromPayload(payloadWithoutBoth, meta);
    expect(parse(render(file))).toEqual(file);
  });
});
