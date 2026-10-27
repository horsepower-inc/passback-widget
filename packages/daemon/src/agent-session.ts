// The daemon records whether the agent is inside passback_wait in <root>/.passback/agent.json, so a
// reader (the panel header) can tell a waiting agent from a working one. A reader treats a dead pid
// as no session; nothing here deletes the file.

import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Clock } from './core/clock';

export type AgentSession = { waiting(): Promise<void>; working(): Promise<void> };

export function createAgentSession(opts: {
  dir: string;
  clock: Clock;
  pid: number;
  agent: () => string;
}): AgentSession {
  const file = path.join(opts.dir, 'agent.json');
  let open = 0;
  let since: string | null = null;
  let queue: Promise<void> = Promise.resolve();
  let seq = 0;

  async function write(body: string): Promise<void> {
    const tmp = `${file}.${opts.pid}.${seq++}.tmp`;
    try {
      await mkdir(opts.dir, { recursive: true });
      await writeFile(tmp, body);
      await rename(tmp, file);
    } catch {
      await rm(tmp, { force: true }).catch(() => undefined);
    }
  }

  // Snapshots the state at call time and writes it after every earlier write has finished.
  function record(): Promise<void> {
    const at = new Date(opts.clock.now()).toISOString();
    const body = `${JSON.stringify({ agent: opts.agent(), pid: opts.pid, waitingSince: since, at })}\n`;
    const next = queue.then(() => write(body));
    queue = next;
    return next;
  }

  return {
    waiting() {
      open += 1;
      if (open === 1) since = new Date(opts.clock.now()).toISOString();
      return record();
    },
    working() {
      open = Math.max(0, open - 1);
      if (open === 0) since = null;
      return record();
    },
  };
}
