// the whole-inbox snapshot (`passback:items`) with the agent session.
// Rows are sent as listInbox returns them, not parsed with ChannelItems.

import {
  listInbox,
  readAgentSession,
  type AgentSession,
  type InboxRow,
} from '@passback/adapters/local';

export type Snapshot = { v: 1; items: InboxRow[]; truncated: boolean; agent: AgentSession };

export async function readSnapshot(opts: {
  passbackDir: string;
  list?: typeof listInbox;
  agent?: typeof readAgentSession;
}): Promise<Snapshot> {
  const { passbackDir, list = listInbox, agent = readAgentSession } = opts;
  const [{ items, truncated }, session] = await Promise.all([
    list(passbackDir),
    agent(passbackDir),
  ]);
  return { v: 1, items, truncated, agent: session };
}
