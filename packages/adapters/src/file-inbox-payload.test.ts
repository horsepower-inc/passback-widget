import { readFileSync, readdirSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parsePayload, redact } from '@passback/schema';
import type { Payload } from '@passback/schema';
import { parse } from '@passback/inbox';
import { FileInboxAdapter } from './file-inbox-adapter';

const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2ln';

function firstPayload(): Payload {
  const dir = fileURLToPath(new URL('../../../fixtures/payloads/', import.meta.url));
  const file = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()[0]!;
  return parsePayload(JSON.parse(readFileSync(path.join(dir, file), 'utf8')));
}

function dirtyPayload(): Payload {
  const payload = firstPayload();
  return { ...payload, intent: { ...payload.intent, comment: `token ${JWT}` } };
}

describe('FileInboxAdapter payload.json', () => {
  let dir: string;
  let adapter: FileInboxAdapter;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'passback-adapters-payload-'));
    adapter = new FileInboxAdapter({ root: dir });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('createIssue writes the redacted payload as <id>/payload.json', async () => {
    const dirty = dirtyPayload();
    const ref = await adapter.createIssue(dirty);
    const text = await readFile(path.join(dir, ref.id, 'payload.json'), 'utf8');
    expect(JSON.parse(text)).toEqual(redact(dirty));
    expect(text).not.toContain(JWT);
  });

  it('payload.json parses with parsePayload', async () => {
    const dirty = dirtyPayload();
    const ref = await adapter.createIssue(dirty);
    const text = await readFile(path.join(dir, ref.id, 'payload.json'), 'utf8');
    expect(() => parsePayload(JSON.parse(text))).not.toThrow();
  });

  it('createIssue writes the redacted comment into <id>.md', async () => {
    const dirty = dirtyPayload();
    const ref = await adapter.createIssue(dirty);
    const text = await readFile(path.join(dir, `${ref.id}.md`), 'utf8');
    const comment = parse(text).comment;
    expect(comment).toBe(redact(dirty).intent.comment);
    expect(comment).not.toContain(JWT);
  });

  it('createIssue does not mutate the payload it is given', async () => {
    const dirty = dirtyPayload();
    const before = structuredClone(dirty);
    await adapter.createIssue(dirty);
    expect(dirty).toEqual(before);
  });

  it('an id collision rejects and keeps the first payload.json and <id>.md', async () => {
    const dirty = dirtyPayload();
    const local = new FileInboxAdapter({ root: dir, newId: () => 'dup-id' });
    await local.createIssue(dirty);
    const payloadBefore = await readFile(path.join(dir, 'dup-id', 'payload.json'), 'utf8');
    const mdBefore = await readFile(path.join(dir, 'dup-id.md'), 'utf8');
    await expect(local.createIssue(dirty)).rejects.toThrow();
    expect(await readFile(path.join(dir, 'dup-id', 'payload.json'), 'utf8')).toBe(payloadBefore);
    expect(await readFile(path.join(dir, 'dup-id.md'), 'utf8')).toBe(mdBefore);
  });

  it('createIssue leaves no temp file in the inbox root or the id directory', async () => {
    const local = new FileInboxAdapter({ root: dir, newId: () => 'one-id' });
    await local.createIssue(firstPayload());
    expect((await readdir(dir)).sort()).toEqual(['one-id', 'one-id.md']);
    expect(await readdir(path.join(dir, 'one-id'))).toEqual(['payload.json']);
  });

  it('an id collision leaves no temp file behind', async () => {
    const local = new FileInboxAdapter({ root: dir, newId: () => 'dup-id' });
    await local.createIssue(firstPayload());
    await expect(local.createIssue(firstPayload())).rejects.toThrow();
    expect((await readdir(dir)).sort()).toEqual(['dup-id', 'dup-id.md']);
    expect(await readdir(path.join(dir, 'dup-id'))).toEqual(['payload.json']);
  });

  it('createIssue rejects an id from newId that is not a plain name and writes nothing', async () => {
    const local = new FileInboxAdapter({ root: path.join(dir, 'inbox'), newId: () => '../escape' });
    await expect(local.createIssue(firstPayload())).rejects.toThrow('invalid new id');
    expect(await readdir(dir)).toEqual([]);
  });
});
