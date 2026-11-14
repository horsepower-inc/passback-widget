import { watch as fsWatch, type FSWatcher, type WatchListener } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export type AgentSession =
  | { state: 'waiting' | 'working'; agent: string; since: string; background?: true }
  | { state: 'absent' };

export interface AgentSessionOptions {
  now?: () => number;
  alive?: (pid: number) => boolean;
}

type Watch = (dir: string, o: { persistent: false }, l: WatchListener<string>) => FSWatcher;

const WORKING_STALE_MS = 30 * 60 * 1000;
const RETRY_MIN_MS = 250;
const RETRY_MAX_MS = 5000;
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
  background: boolean;
}

function parseFile(raw: unknown): AgentFile | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { agent, pid, waitingSince, at, background } = raw as Record<string, unknown>;
  if (typeof agent !== 'string' || agent === '') return null;
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return null;
  if (waitingSince !== null && !isDate(waitingSince)) return null;
  if (!isDate(at)) return null;
  return { agent, pid, waitingSince, at, background: background === true };
}

export async function readAgentSession(
  passbackDir: string,
  opts: AgentSessionOptions = {},
): Promise<AgentSession> {
  try {
    const f = parseFile(JSON.parse(await readFile(join(passbackDir, 'agent.json'), 'utf8')));
    if (f === null || !(opts.alive ?? pidAlive)(f.pid)) return ABSENT;
    const bg = f.background ? { background: true as const } : {};
    if (f.waitingSince !== null) {
      return { state: 'waiting', agent: f.agent, since: f.waitingSince, ...bg };
    }
    const age = (opts.now ?? Date.now)() - Date.parse(f.at);
    return age <= WORKING_STALE_MS
      ? { state: 'working', agent: f.agent, since: f.at, ...bg }
      : ABSENT;
  } catch {
    return ABSENT;
  }
}

export function watchAgentSession(
  passbackDir: string,
  onChange: () => void,
  watch: Watch = fsWatch as Watch,
): () => void {
  let stopped = false;
  let failed = false;
  let delay = RETRY_MIN_MS;
  let watcher: FSWatcher | undefined;
  let timer: NodeJS.Timeout | undefined;

  const closeWatcher = (): void => {
    const w = watcher;
    watcher = undefined;
    try {
      w?.close();
    } catch {
      // already gone
    }
  };

  const fail = (from?: FSWatcher): void => {
    if (stopped || (from !== undefined && from !== watcher)) return;
    closeWatcher();
    if (timer !== undefined) return;
    failed = true;
    timer = setTimeout(attempt, delay);
    timer.unref();
    delay = Math.min(delay * 2, RETRY_MAX_MS);
  };

  function attempt(): void {
    timer = undefined;
    if (stopped) return;
    let w: FSWatcher;
    try {
      w = watch(passbackDir, { persistent: false }, (_event, name) => {
        if (!stopped && String(name) === 'agent.json') onChange();
      });
    } catch {
      fail();
      return;
    }
    watcher = w;
    w.on('error', () => fail(w));
    delay = RETRY_MIN_MS;
    if (failed) {
      failed = false;
      onChange();
    }
  }

  attempt();
  return () => {
    if (stopped) return;
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    closeWatcher();
  };
}
