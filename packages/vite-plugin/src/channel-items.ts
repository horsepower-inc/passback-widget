// the whole-inbox snapshot (`passback:items`) and its debounced push.
// Rows are sent as listInbox returns them, not parsed with ChannelItems (widens the schema).

import { readdir } from 'node:fs/promises';
import path from 'node:path';
import {
  listInbox,
  readAgentSession,
  watchAgentSession,
  type AgentSession,
  type InboxRow,
} from '@passback/adapters/local';

// `agent` is the session in .passback/agent.json: { state: 'waiting' | 'working', agent, since } or { state: 'absent' }.
export type ItemsMessage = { v: 1; items: InboxRow[]; truncated: boolean; agent: AgentSession };

export type ItemsPushOptions = {
  passbackDir: string;
  broadcast: (message: ItemsMessage) => void;
  log: (message: string) => void;
  debounceMs?: number;
  list?: typeof listInbox;
  agent?: typeof readAgentSession;
  watchSession?: typeof watchAgentSession;
};

// listInbox lists an unreadable inbox as empty; read it first so only a missing inbox is empty.
async function listReadableInbox(passbackDir: string): ReturnType<typeof listInbox> {
  await readdir(path.join(passbackDir, 'inbox')).catch((err: NodeJS.ErrnoException) => {
    if (err.code !== 'ENOENT') throw err;
  });
  return listInbox(passbackDir);
}

export type ItemsPush = {
  snapshot(): Promise<ItemsMessage | undefined>;
  schedule(): void;
  stop(): void;
};

export function createItemsPush(opts: ItemsPushOptions): ItemsPush {
  const {
    passbackDir,
    broadcast,
    log,
    debounceMs = 100,
    list = listReadableInbox,
    agent = readAgentSession,
    watchSession = watchAgentSession,
  } = opts;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let reading = false;
  let again = false;
  let stopped = false;

  async function snapshot(): Promise<ItemsMessage | undefined> {
    try {
      const [{ items, truncated }, session] = await Promise.all([
        list(passbackDir),
        agent(passbackDir),
      ]);
      return { v: 1, items, truncated, agent: session };
    } catch (err) {
      log(`channel: inbox list failed (${err instanceof Error ? err.message : String(err)})`);
      return undefined;
    }
  }

  function arm(): void {
    timer = setTimeout(() => {
      timer = undefined;
      void push();
    }, debounceMs);
    timer.unref();
  }

  function schedule(): void {
    if (stopped) return;
    if (reading) again = true;
    else if (timer === undefined) arm();
  }

  async function push(): Promise<void> {
    reading = true;
    const message = await snapshot();
    reading = false;
    if (stopped) return;
    if (message) broadcast(message);
    if (again) arm();
    again = false;
  }

  const closeWatch = watchSession(passbackDir, () => schedule());

  return {
    snapshot,
    schedule,
    stop() {
      stopped = true;
      clearTimeout(timer);
      closeWatch();
    },
  };
}
