import { describe, expect, it } from 'vitest';
import { MAX_ENTRIES, WINDOW_MS, createRing, type Entry } from './ring';

function fakeClock(start = 0): { now: () => number; advance: (ms: number) => void } {
  let time = start;
  return {
    now: () => time,
    advance: (ms: number) => {
      time += ms;
    },
  };
}

const consoleEntry = (message: string): Entry => ({ kind: 'console', level: 'error', message });

describe('createRing', () => {
  it('drops entries older than 30 seconds', () => {
    const clock = fakeClock();
    const ring = createRing(clock.now);

    ring.push(consoleEntry('old'));
    clock.advance(WINDOW_MS + 1);
    ring.push(consoleEntry('new'));

    const snapshot = ring.snapshot();

    expect(snapshot.map((e) => (e.kind === 'console' ? e.message : undefined))).toEqual(['new']);
  });

  it('keeps at most 200 entries', () => {
    const clock = fakeClock();
    const ring = createRing(clock.now);

    for (let i = 0; i < MAX_ENTRIES + 10; i += 1) {
      ring.push(consoleEntry(`m${i}`));
    }

    const snapshot = ring.snapshot();

    expect(snapshot.length).toBe(MAX_ENTRIES);
    expect(snapshot[0]).toMatchObject({ message: 'm10' });
    expect(snapshot[snapshot.length - 1]).toMatchObject({ message: `m${MAX_ENTRIES + 9}` });
  });

  it('reports t in milliseconds before the snapshot', () => {
    const clock = fakeClock();
    const ring = createRing(clock.now);

    ring.push(consoleEntry('a'));
    clock.advance(1000);
    ring.push(consoleEntry('b'));
    clock.advance(500);

    const snapshot = ring.snapshot();

    expect(snapshot[0]?.t).toBe(-1500);
    expect(snapshot[1]?.t).toBe(-500);
  });
});
