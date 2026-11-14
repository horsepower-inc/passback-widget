// MarkView is the wire shape passback_wait hands the agent. A missing or
// unreadable attachment (screenshot, payload) leaves the field out; it never fails the call.

import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveChain, type InboxFile } from '@passback/inbox';
import { reopenedFeedback } from './inbox-store';
import { Code, type Timeline } from '@passback/schema';

export type MarkView = {
  id: string;
  comment: string;
  route: string;
  selector: string;
  file?: string;
  buildId?: string;
  inboxFile: string;
  screenshot?: string;
  timeline?: Timeline;
  reopened?: { iteration: number; comment: string };
};

async function findScreenshot(inboxDir: string, id: string): Promise<string | undefined> {
  const screenshotPath = path.join(inboxDir, id, 'screenshot.png');
  try {
    await access(screenshotPath);
    return screenshotPath;
  } catch {
    return undefined;
  }
}

async function readPayload(inboxDir: string, id: string): Promise<unknown> {
  try {
    const raw = await readFile(path.join(inboxDir, id, 'payload.json'), 'utf8');
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

function timelineFromPayload(payload: unknown): Timeline | undefined {
  const timeline = (payload as { timeline?: unknown } | undefined)?.timeline;
  return Array.isArray(timeline) ? (timeline as Timeline) : undefined;
}

/** First chain entry with a `file`, once hashes are resolved through `ids`, formatted `file:line:col`. */
function fileFromChain(
  payload: unknown,
  ids: Readonly<Record<string, string>>,
): string | undefined {
  const chain = (payload as { code?: { chain?: unknown } } | undefined)?.code?.chain;
  const parsed = Code.shape.chain.safeParse(chain);
  if (!parsed.success) return undefined;
  const entry = resolveChain(parsed.data, ids).find((e) => e.file !== undefined);
  if (!entry) return undefined;
  return [entry.file, entry.line, entry.col].filter((part) => part !== undefined).join(':');
}

/** Reshapes an acked `InboxFile` into the `MarkView` `passback_wait` hands the agent. */
export async function toMarkView(
  inboxDir: string,
  file: InboxFile,
  ids?: Readonly<Record<string, string>>,
): Promise<MarkView> {
  const [screenshot, payload] = await Promise.all([
    findScreenshot(inboxDir, file.id),
    readPayload(inboxDir, file.id),
  ]);
  const resolvedFile = file.file ?? (ids !== undefined ? fileFromChain(payload, ids) : undefined);
  const timeline = timelineFromPayload(payload);
  const reopened = reopenedFeedback(file);
  return {
    id: file.id,
    comment: file.comment,
    route: file.route,
    selector: file.selector,
    ...(resolvedFile !== undefined ? { file: resolvedFile } : {}),
    ...(file.buildId !== undefined ? { buildId: file.buildId } : {}),
    inboxFile: path.join(inboxDir, `${file.id}.md`),
    ...(screenshot !== undefined ? { screenshot } : {}),
    ...(timeline !== undefined ? { timeline } : {}),
    ...(reopened !== undefined ? { reopened } : {}),
  };
}
