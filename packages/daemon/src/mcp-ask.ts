// passback_ask writes a `question` status, then blocks
// until the plugin writes the reporter's answer file or the timeout passes.

import { access } from 'node:fs/promises';
import path from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { MarkId } from '@passback/schema';
import type { Clock } from './core/clock';
import { writeStatus } from './outbox';
import { clearAnswer, waitForAnswer } from './wait-for-answer';

export type RegisterAskOptions = {
  root: string;
  clock: Clock;
};

const ASK_DESCRIPTION =
  "Asks the reporter one question about a comment and blocks until they answer in the browser, returning `{ answer, answeredAt }`, or `{ timedOut: true }` when no answer comes in time. Ask only when you cannot go on without the reporter, and keep the question to one short sentence. Treat `timedOut` as 'carry on with the best assumption and say so in the final status'.";

function toolError(message: string): {
  content: [{ type: 'text'; text: string }];
  isError: true;
} {
  return { content: [{ type: 'text', text: message }], isError: true };
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

export function registerAsk(server: McpServer, opts: RegisterAskOptions): void {
  const inboxDir = path.join(opts.root, '.passback', 'inbox');
  const outboxDir = path.join(opts.root, '.passback', 'outbox');
  const answersDir = path.join(opts.root, '.passback', 'answers');
  const { clock } = opts;

  server.registerTool(
    'passback_ask',
    {
      description: ASK_DESCRIPTION,
      inputSchema: {
        commentId: z.string().describe('The id of the comment, as passback_wait returned it.'),
        question: z.string().trim().min(1).max(2000),
        timeoutSec: z.number().int().min(1).max(1800).default(600),
      },
    },
    async ({ commentId, question, timeoutSec }, extra) => {
      if (!MarkId.safeParse(commentId).success) {
        return toolError(`not a comment id: ${commentId}`);
      }
      if (!(await exists(path.join(inboxDir, `${commentId}.md`)))) {
        return toolError(`unknown comment: ${commentId}`);
      }
      let answer: Awaited<ReturnType<typeof waitForAnswer>>;
      try {
        await clearAnswer(answersDir, commentId);
        await writeStatus(
          { markId: commentId, state: 'question', message: question },
          { outboxDir, clock },
        );
        answer = await waitForAnswer({
          answersDir,
          markId: commentId,
          timeoutMs: timeoutSec * 1000,
          signal: extra.signal,
          clock,
        });
      } catch (err) {
        return toolError(err instanceof Error ? err.message : String(err));
      }
      const body = answer ? { answer: answer.text, answeredAt: answer.at } : { timedOut: true };
      return {
        content: [{ type: 'text', text: JSON.stringify(body) }],
        structuredContent: body,
      };
    },
  );
}
