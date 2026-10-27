// the daemon is an MCP server over stdio that the developer's own
// agent launches. Its whole tool surface is passback_wait, passback_status and passback_open.

import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z, ZodError } from 'zod';
import { MarkState } from '@passback/schema';
import { systemClock } from './adapters/system-clock';
import { createAgentSession, type AgentSession } from './agent-session';
import type { Clock } from './core/clock';
import { proposeMark } from './inbox-store';
import { writeStatus } from './outbox';
import { openInBrowser, resolveOpenUrl } from './open';
import { toMarkView } from './mark-view';
import { waitForMarks } from './wait-for-marks';
import { readManifestIds } from './manifest';
import { takeWithdrawn } from './withdrawn';

export type CreatePassbackServerOptions = {
  root: string;
  open?: (url: string) => Promise<void>;
  clock?: Clock;
};

const WAIT_DESCRIPTION =
  'Blocks until the developer leaves one or more comments in the browser, then returns them as `comments`; `marks` is a deprecated alias of `comments`, retained for one release; a comment the reporter reopened comes back with a `reopened` field holding the new comment; a `withdrawn` list names comments the developer took back while you were working on them, to be skipped; call again when it returns an empty list.';
const STATUS_DESCRIPTION =
  "Reports progress on one comment so its dot updates in the browser: pass its `commentId` (`markId` is a deprecated alias retained for one release), call 'running' when you start a comment, and 'done' or 'failed' when you finish.";
const OPEN_DESCRIPTION = "Shows the app in the developer's browser.";

/**
 * Renders a thrown validation error so its message names the offending field; `idField` is the
 * name the caller used for the internal `markId`.
 */
function describeError(err: unknown, idField = 'markId'): string {
  if (err instanceof ZodError) {
    return err.issues
      .map((issue) => {
        const field = issue.path.map((p) => (p === 'markId' ? idField : p)).join('.');
        return `${issue.message} at ${field}`;
      })
      .join('\n');
  }
  return err instanceof Error ? err.message : String(err);
}

function toolError(
  err: unknown,
  idField?: string,
): { content: [{ type: 'text'; text: string }]; isError: true } {
  return { content: [{ type: 'text', text: describeError(err, idField) }], isError: true };
}

/** Resolves `commentId` and its deprecated alias `markId` to the one internal mark id. */
function resolveCommentId(
  commentId: string | undefined,
  markId: string | undefined,
): { markId: string; idField: string } | { error: string } {
  if (commentId === undefined && markId === undefined) {
    return { error: 'passback_status needs commentId (or the deprecated markId)' };
  }
  if (commentId !== undefined && markId !== undefined && commentId !== markId) {
    return {
      error: 'commentId and markId differ; pass commentId alone, or the same value in both',
    };
  }
  return commentId !== undefined
    ? { markId: commentId, idField: 'commentId' }
    : { markId: markId as string, idField: 'markId' };
}

function registerWait(
  server: McpServer,
  root: string,
  inboxDir: string,
  clock: Clock,
  session: AgentSession,
): void {
  server.registerTool(
    'passback_wait',
    {
      description: WAIT_DESCRIPTION,
      inputSchema: { timeoutSec: z.number().int().min(1).max(600).optional() },
    },
    async ({ timeoutSec }, extra) => {
      const before = await takeWithdrawn(inboxDir);
      await session.waiting();
      let files: Awaited<ReturnType<typeof waitForMarks>>;
      try {
        files = await waitForMarks({
          root: inboxDir,
          timeoutMs: before.length > 0 ? 0 : (timeoutSec ?? 120) * 1000,
          signal: extra.signal,
          clock,
        });
      } finally {
        await session.working();
      }
      const withdrawn = [...before, ...(await takeWithdrawn(inboxDir))].sort();
      const comments = await Promise.all(
        files.map(async (file) =>
          toMarkView(inboxDir, file, await readManifestIds(root, file.buildId)),
        ),
      );
      const body =
        withdrawn.length > 0
          ? { comments, marks: comments, withdrawn }
          : { comments, marks: comments };
      return {
        content: [{ type: 'text', text: JSON.stringify(body) }],
        structuredContent: body,
      };
    },
  );
}

function registerStatus(
  server: McpServer,
  inboxDir: string,
  outboxDir: string,
  clock: Clock,
): void {
  server.registerTool(
    'passback_status',
    {
      description: STATUS_DESCRIPTION,
      inputSchema: {
        commentId: z
          .string()
          .optional()
          .describe('The id of the comment, as passback_wait returned it. Preferred over markId.'),
        markId: z
          .string()
          .optional()
          .describe('Deprecated alias of commentId, retained for one release.'),
        state: MarkState,
        message: z.string().optional(),
        prUrl: z.string().optional(),
      },
    },
    async ({ commentId, markId: legacyMarkId, state, message, prUrl }) => {
      const id = resolveCommentId(commentId, legacyMarkId);
      if ('error' in id) return toolError(new Error(id.error));
      const { markId } = id;
      let written: string;
      try {
        written = await writeStatus({ markId, state, message, prUrl }, { outboxDir, clock });
      } catch (err) {
        return toolError(err, id.idField);
      }
      let proposed = false;
      if (state === 'done') {
        const result = await proposeMark(inboxDir, markId, {
          at: new Date(clock.now()).toISOString(),
          text: message ?? 'done',
        });
        proposed = result !== undefined;
      }
      return {
        content: [{ type: 'text', text: JSON.stringify({ written, proposed }) }],
        structuredContent: { written, proposed },
      };
    },
  );
}

function registerOpen(server: McpServer, open: ((url: string) => Promise<void>) | undefined): void {
  server.registerTool(
    'passback_open',
    {
      description: OPEN_DESCRIPTION,
      inputSchema: { url: z.string().optional() },
    },
    async ({ url }) => {
      const resolved = resolveOpenUrl(url, process.env);
      try {
        if (open) {
          await openInBrowser(resolved, { spawn: (_cmd, args) => open(args[0] ?? resolved) });
        } else {
          await openInBrowser(resolved);
        }
      } catch (err) {
        return toolError(err);
      }
      return {
        content: [{ type: 'text', text: JSON.stringify({ opened: resolved }) }],
        structuredContent: { opened: resolved },
      };
    },
  );
}

export function createPassbackServer(opts: CreatePassbackServerOptions): McpServer {
  const inboxDir = path.join(opts.root, '.passback', 'inbox');
  const outboxDir = path.join(opts.root, '.passback', 'outbox');

  const clock = opts.clock ?? systemClock;
  const server = new McpServer({ name: 'passback', version: '0.0.0' });
  const session = createAgentSession({
    dir: path.join(opts.root, '.passback'),
    clock,
    pid: process.pid,
    agent: () => server.server.getClientVersion()?.name ?? 'unknown',
  });
  registerWait(server, opts.root, inboxDir, clock, session);
  registerStatus(server, inboxDir, outboxDir, clock);
  registerOpen(server, opts.open);
  return server;
}

/** Connects a `createPassbackServer` instance to stdio; nothing but MCP frames touches stdout. */
export async function startMcpServer(opts: { root?: string } = {}): Promise<void> {
  const server = createPassbackServer({ root: opts.root ?? process.cwd() });
  await server.connect(new StdioServerTransport());
}
