import { describe, expect, it, vi } from 'vitest';
import type { ChannelAck, ChannelStatus } from '@passback/schema';
import { createChannel } from './channel';
import { createSandboxHot, SANDBOX_MESSAGES } from './sandbox';

type Status = { v: number; markId: string; state: string; message: string; at: string };
type Timer = { run: () => void; ms: number };

function manualTimers() {
  const timers: Timer[] = [];
  return {
    timers,
    setTimer: (run: () => void, ms: number) => {
      timers.push({ run, ms });
      return timers.length;
    },
    runAll() {
      for (const t of [...timers].sort((a, b) => a.ms - b.ms)) t.run();
    },
    runAt(ms: number) {
      for (const t of timers.filter((x) => x.ms === ms)) t.run();
    },
  };
}

function setup(extra: Parameters<typeof createSandboxHot>[0] = {}) {
  const clock = manualTimers();
  let n = 0;
  const hot = createSandboxHot({
    setTimer: clock.setTimer,
    now: () => new Date('2026-10-03T12:00:00.000Z'),
    newId: () => `id-${++n}`,
    ...extra,
  });
  const acks: unknown[] = [];
  const statuses: Status[] = [];
  hot.on('passback:ack', (d) => acks.push(d));
  hot.on('passback:status', (d) => statuses.push(d as Status));
  return { clock, hot, acks, statuses };
}

const batch = { v: 1, batch: { id: 'B1', marks: [{}, {}] } };

describe('createSandboxHot', () => {
  it('acks a mark batch with one new id per mark and the batch id', () => {
    const { clock, hot, acks } = setup();
    hot.send('passback:mark', batch);
    expect(acks).toEqual([]);
    clock.runAt(0);
    expect(acks).toEqual([{ v: 1, batchId: 'B1', accepted: ['id-1', 'id-2'], trimmed: [] }]);
  });

  it('plays queued, running and done for each accepted mark at the configured delays', () => {
    const { clock, hot, statuses } = setup({
      queuedAfterMs: 10,
      runningAfterMs: 20,
      doneAfterMs: 30,
    });
    hot.send('passback:mark', batch);
    expect(clock.timers.map((t) => t.ms)).toEqual([0, 10, 20, 30]);
    clock.runAt(10);
    expect(statuses.map((s) => [s.markId, s.state])).toEqual([
      ['id-1', 'queued'],
      ['id-2', 'queued'],
    ]);
    clock.runAt(20);
    clock.runAt(30);
    expect(statuses.slice(2).map((s) => [s.markId, s.state])).toEqual([
      ['id-1', 'running'],
      ['id-2', 'running'],
      ['id-1', 'done'],
      ['id-2', 'done'],
    ]);
  });

  it('sends the first status in a later timer than the ack', () => {
    const { clock, hot, acks, statuses } = setup();
    hot.send('passback:mark', batch);
    clock.timers[0]!.run();
    expect(acks).toHaveLength(1);
    expect(statuses).toEqual([]);
    expect(clock.timers.slice(1).every((t) => t !== clock.timers[0])).toBe(true);
    clock.timers[1]!.run();
    expect(statuses.length).toBeGreaterThan(0);
  });

  it('stamps each status with the injected clock and carries no pull-request link', () => {
    const { clock, hot, statuses } = setup();
    hot.send('passback:mark', batch);
    clock.runAll();
    expect(statuses).toHaveLength(6);
    for (const s of statuses) {
      expect(s.at).toBe('2026-10-03T12:00:00.000Z');
      expect(s.v).toBe(1);
      expect('prUrl' in s).toBe(false);
    }
  });

  it('uses the default messages and lets the caller replace one', () => {
    const a = setup();
    a.hot.send('passback:mark', batch);
    a.clock.runAll();
    expect(a.statuses.map((s) => s.message).slice(0, 6)).toEqual([
      SANDBOX_MESSAGES.queued,
      SANDBOX_MESSAGES.queued,
      SANDBOX_MESSAGES.running,
      SANDBOX_MESSAGES.running,
      SANDBOX_MESSAGES.done,
      SANDBOX_MESSAGES.done,
    ]);
    const b = setup({ messages: { done: 'Done!' } });
    b.hot.send('passback:mark', batch);
    b.clock.runAll();
    expect(b.statuses.at(-1)?.message).toBe('Done!');
    expect(b.statuses[0]?.message).toBe(SANDBOX_MESSAGES.queued);
  });

  it('answers a malformed mark with an error ack and no status', () => {
    const { clock, hot, acks, statuses } = setup();
    hot.send('passback:mark', { v: 1, batch: { id: 'B2', marks: [] } });
    hot.send('passback:mark', 'nope');
    clock.runAll();
    const error = { code: 'sandbox_invalid', message: 'not a mark batch' };
    expect(acks).toEqual([
      { v: 1, batchId: 'B2', accepted: [], trimmed: [], error },
      { v: 1, batchId: '', accepted: [], trimmed: [], error },
    ]);
    expect(statuses).toEqual([]);
    expect(clock.timers.every((t) => t.ms === 0)).toBe(true);
  });

  it('ignores an orphaned message and any other event', () => {
    const { clock, hot, acks, statuses } = setup();
    hot.send('passback:orphaned', { v: 1, markIds: ['x'] });
    hot.send('something:else', batch);
    clock.runAll();
    expect(clock.timers).toEqual([]);
    expect(acks).toEqual([]);
    expect(statuses).toEqual([]);
  });

  it('stops calling a listener after off and survives a listener that throws', () => {
    const { clock, hot, acks } = setup();
    const gone = vi.fn();
    hot.on('passback:ack', gone);
    hot.off?.('passback:ack', gone);
    hot.off?.('passback:ack', () => {});
    hot.on('passback:ack', () => {
      throw new Error('boom');
    });
    const last = vi.fn();
    hot.on('passback:ack', last);
    hot.send('passback:mark', batch);
    expect(() => clock.runAll()).not.toThrow();
    expect(gone).not.toHaveBeenCalled();
    expect(acks).toHaveLength(1);
    expect(last).toHaveBeenCalledTimes(1);
  });

  it('never calls fetch', () => {
    const fetchStub = vi.fn();
    vi.stubGlobal('fetch', fetchStub);
    try {
      const { clock, hot } = setup();
      hot.send('passback:mark', batch);
      clock.runAll();
      expect(fetchStub).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('speaks the real channel: createChannel sends a batch and receives the ack and the statuses', () => {
    const clock = manualTimers();
    let n = 0;
    const hot = createSandboxHot({ setTimer: clock.setTimer, newId: () => `m${++n}` });
    const acks: ChannelAck[] = [];
    const statuses: ChannelStatus[] = [];
    const channel = createChannel(hot, {
      onAck: (a) => acks.push(a),
      onStatus: (s) => statuses.push(s),
    });
    expect(channel.sendMark({ id: 'B3', marks: [{}] } as never)).toBe(true);
    clock.runAll();
    expect(acks[0]).toMatchObject({ batchId: 'B3', accepted: ['m1'] });
    expect(statuses.map((s) => s.state)).toEqual(['queued', 'running', 'done']);
    channel.dispose();
  });
});
