export type AgentId = 'claude' | 'codex' | 'cursor';

const ALL_AGENTS: AgentId[] = ['claude', 'codex', 'cursor'];

function isAgentId(name: string): name is AgentId {
  return (ALL_AGENTS as string[]).includes(name);
}

/** Parses a comma separated agent list; `all` is every agent, duplicates keep their first place. */
export function parseAgentList(text: string): AgentId[] | { error: string } {
  const result: AgentId[] = [];
  for (const name of text.split(',')) {
    const names = name === 'all' ? ALL_AGENTS : isAgentId(name) ? [name] : undefined;
    if (names === undefined) {
      return { error: text };
    }
    for (const id of names) {
      if (!result.includes(id)) {
        result.push(id);
      }
    }
  }
  return result;
}

export type AgentMarker =
  '.claude/' | '.codex/' | '.agents/' | '.cursor/' | '.mcp.json' | 'AGENTS.md';

/** Markers in explanation order, each with the agent it points at. */
const MARKER_AGENTS: [AgentMarker, AgentId][] = [
  ['.claude/', 'claude'],
  ['.codex/', 'codex'],
  ['.agents/', 'codex'],
  ['.cursor/', 'cursor'],
  ['.mcp.json', 'claude'],
  ['AGENTS.md', 'codex'],
];

const DIR_MARKERS: AgentMarker[] = ['.claude/', '.codex/', '.agents/', '.cursor/'];

export interface AgentEvidence {
  flag?: AgentId[];
  /** Root markers found: directories first count, files only when no directory exists. */
  markers?: AgentMarker[];
}

/** The markers that count: the directories when any exist, otherwise the files. */
function usedMarkers(markers: AgentMarker[] = []): AgentMarker[] {
  const dirs = markers.filter((m) => DIR_MARKERS.includes(m));
  return dirs.length > 0 ? dirs : markers.filter((m) => !DIR_MARKERS.includes(m));
}

/** The agents to wire: the flag when given, otherwise those the root markers point at, else claude. */
export function selectAgents(input: AgentEvidence): AgentId[] {
  if (input.flag) {
    return [...input.flag];
  }
  const used = usedMarkers(input.markers);
  const found = MARKER_AGENTS.filter(([m]) => used.includes(m)).map(([, id]) => id);
  const agents = ALL_AGENTS.filter((id) => found.includes(id));
  return agents.length > 0 ? agents : ['claude'];
}

/** One `agents:` line per selected agent saying why it was selected. */
export function explainAgents(input: AgentEvidence): string[] {
  const agents = selectAgents(input);
  if (input.flag) {
    return agents.map((id) => `agents: ${id} (--agents)`);
  }
  const used = usedMarkers(input.markers);
  if (used.length === 0) {
    return ['agents: claude (fallback: no agent markers found)'];
  }
  return agents.map((id) => {
    const why = MARKER_AGENTS.filter(([m, a]) => a === id && used.includes(m)).map(([m]) => m);
    return `agents: ${id} (detected: ${why.join(', ')})`;
  });
}
