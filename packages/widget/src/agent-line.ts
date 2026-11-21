export type AgentLine = { state: 'waiting' | 'working' | 'absent'; text: string };

// Client names made readable; any other name is shown as it came.
const KNOWN: [string, string][] = [
  ['claude', 'Claude Code'],
  ['codex', 'Codex'],
  ['cursor', 'Cursor'],
];

function readable(agent: string): string {
  const lower = agent.toLowerCase();
  return KNOWN.find(([part]) => lower.includes(part))?.[1] ?? agent;
}

// `raw` is the snapshot's `agent` as it arrived: checked here, since the widget imports only types.
export function agentLine(raw: unknown): AgentLine | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const { state, agent } = raw as { state?: unknown; agent?: unknown };
  if (state === 'absent') return { state, text: 'No agent session: type /passback' };
  if ((state === 'waiting' || state === 'working') && typeof agent === 'string' && agent !== '') {
    const background = (raw as { background?: unknown }).background === true;
    return { state, text: `${readable(agent)} ${state}${background ? ' (background)' : ''}` };
  }
  return undefined;
}
