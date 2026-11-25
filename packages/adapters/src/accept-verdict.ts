// The plugin-side writer for passback:verdict: apply the human's accept,
// withdraw, park or unpark to the mark's inbox file. The plugin cannot reach the daemon
// (filesystem IPC only), so the plugin side writes the inbox, the way acceptReopen does.

import { randomUUID } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { applyVerdict, parse, render, transition, type InboxFile } from '@passback/inbox';
import { ChannelVerdict } from '@passback/schema';

export type VerdictResult = { ok: true } | { ok: false; error: 'invalid' | 'missing' | 'illegal' };

async function writeAtomic(target: string, text: string): Promise<void> {
  const tmp = `${target}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmp, text, { flag: 'wx' });
  await rename(tmp, target);
}

function applyAccept(file: InboxFile, at: string): InboxFile {
  const current = file.iterations.find((it) => it.n === file.iteration);
  if (file.status === 'accepted' && current?.human?.verdict.kind === 'accept') return file;
  return applyVerdict(file, { at, verdict: { kind: 'accept' } });
}

function applyWithdraw(file: InboxFile): InboxFile {
  if (file.status === 'withdrawn') return file;
  return { ...file, status: transition(file.status, 'withdrawn', 'human') };
}

function applyPark(file: InboxFile, park: boolean): InboxFile {
  if (file.status === 'accepted' || file.status === 'withdrawn') {
    throw new Error(`cannot park or unpark while status is '${file.status}'`);
  }
  if (park === (file.parked === true)) return file;
  const rest = { ...file };
  delete rest.parked;
  return park ? { ...rest, parked: true } : rest;
}

/** The file after the verdict, `file` itself for a repeat, or undefined for an illegal move. */
function next(file: InboxFile, verdict: ChannelVerdict['verdict'], at: string) {
  try {
    if (verdict === 'accept') return applyAccept(file, at);
    if (verdict === 'withdraw') return applyWithdraw(file);
    return applyPark(file, verdict === 'park');
  } catch {
    return undefined;
  }
}

async function apply(passbackDir: string, input: unknown, at: string): Promise<VerdictResult> {
  const parsed = ChannelVerdict.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const { markId, verdict } = parsed.data;
  const target = path.join(passbackDir, 'inbox', `${markId}.md`);
  let file: InboxFile;
  try {
    file = parse(await readFile(target, 'utf8'));
  } catch {
    return { ok: false, error: 'missing' };
  }
  const updated = next(file, verdict, at);
  if (!updated) return { ok: false, error: 'illegal' };
  if (updated !== file) await writeAtomic(target, render(updated));
  return { ok: true };
}

/** Applies an unknown `passback:verdict` payload to the mark's inbox file under
 * `<passbackDir>/inbox`. A repeat of an applied verdict is ok and rewrites nothing; an illegal
 * move leaves the file unchanged. Never throws or rejects. */
export async function acceptVerdict(
  passbackDir: string,
  input: unknown,
  now: () => Date = () => new Date(),
): Promise<VerdictResult> {
  try {
    return await apply(passbackDir, input, now().toISOString());
  } catch {
    return { ok: false, error: 'illegal' };
  }
}
