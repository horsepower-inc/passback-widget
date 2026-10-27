import { watch as fsWatch, type FSWatcher, type WatchListener } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export type AgentSession =
  { state: 'waiting' | 'working'; agent: string; since: string } | { state: 'absent' };

export interface AgentSessionOptions {
  now?: () => number;
  alive?: (pid: number) => boolean;
}

type Watch = (dir: string, o: { persistent: false }, l: WatchListener<string>) => FSWatcher;

const WORKING_STALE_MS = 30 * 60 * 1000;
const ABSENT: AgentSession = { state: 'absent' };

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

const isDate = (v: unknown): v is string => typeof v === 'string' && !Number.isNaN(Date.parse(v));

interface AgentFile {
  agent: string;
  pid: number;
  waitingSince: string | null;
  at: string;
}

function parseFile(raw: unknown): AgentFile | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { agent, pid, waitingSince, at } = raw as Record<string, unknown>;
  if (typeof agent !== 'string' || agent === '') return null;
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return null;
  if (waitingSince !== null && !isDate(waitingSince)) return null;
  if (!isDate(at)) return null;
  return { agent, pid, waitingSince, at };
}

export async function readAgentSession(
  passbackDir: string,
  opts: AgentSessionOptions = {},
): Promise<AgentSession> {
  try {
    const f = parseFile(JSON.parse(await readFile(join(passbackDir, 'agent.json'), 'utf8')));
    if (f === null || !(opts.alive ?? pidAlive)(f.pid)) return ABSENT;
    if (f.waitingSince !== null) return { state: 'waiting', agent: f.agent, since: f.waitingSince };
    const age = (opts.now ?? Date.now)() - Date.parse(f.at);
    return age <= WORKING_STALE_MS ? { state: 'working', agent: f.agent, since: f.at } : ABSENT;
  } catch {
    return ABSENT;
  }
}

export function watchAgentSession(
  passbackDir: string,
  onChange: () => void,
  watch: Watch = fsWatch as Watch,
): () => void {
  try {
    const watcher = watch(passbackDir, { persistent: false }, (_event, name) => {
      if (String(name) === 'agent.json') onChange();
    });
    let closed = false;
    const stop = (): void => {
      if (closed) return;
      closed = true;
      try {
        watcher.close();
      } catch {
        // already gone
      }
    };
    watcher.on('error', stop);
    return stop;
  } catch {
    return () => {};
  }
}
