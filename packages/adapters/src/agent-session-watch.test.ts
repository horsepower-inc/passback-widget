import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { watchAgentSession } from './agent-session.js';

type Handler = () => void;

function fakeWatch(failures: number) {
  let left = failures;
  const watchers: { close: ReturnType<typeof vi.fn>; fire: Handler }[] = [];
  const watch = vi.fn<(d: string, o: unknown, l: (e: string, n: string) => void) => unknown>(() => {
    if (left-- > 0) throw new Error('ENOENT');
    let fire: Handler = () => {};
    const w = {
      close: vi.fn(),
      on: (_e: string, h: Handler) => {
        fire = h;
        return w;
      },
    };
    watchers.push({
      close: w.close,
      get fire() {
        return fire;
      },
    });
    return w;
  });
  return { watch, watchers };
}

describe('watchAgentSession retries', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('arms the watch when the folder appears after a failed start and reports one change', () => {
    const { watch, watchers } = fakeWatch(1);
    const onChange = vi.fn();
    watchAgentSession('/d', onChange, watch as never);
    expect(watch).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(249);
    expect(watch).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(watch).toHaveBeenCalledTimes(2);
    expect(watchers).toHaveLength(1);
    expect(onChange).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_000);
    expect(watch).toHaveBeenCalledTimes(2);
  });

  it('arms the watch again after the watcher reports an error', () => {
    const { watch, watchers } = fakeWatch(0);
    const onChange = vi.fn();
    watchAgentSession('/d', onChange, watch as never);
    expect(onChange).not.toHaveBeenCalled();
    watchers[0]!.fire();
    watchers[0]!.fire();
    expect(watchers[0]!.close).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(250);
    expect(watch).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('waits longer after each failed try and never more than five seconds', () => {
    const { watch } = fakeWatch(100);
    watchAgentSession('/d', vi.fn(), watch as never);
    let calls = 1;
    for (const wait of [250, 500, 1000, 2000, 4000, 5000, 5000]) {
      vi.advanceTimersByTime(wait - 1);
      expect(watch).toHaveBeenCalledTimes(calls);
      vi.advanceTimersByTime(1);
      expect(watch).toHaveBeenCalledTimes(++calls);
    }
  });

  it('stops trying once the returned function is called', () => {
    const { watch, watchers } = fakeWatch(1);
    const onChange = vi.fn();
    const stop = watchAgentSession('/d', onChange, watch as never);
    stop();
    stop();
    vi.advanceTimersByTime(10_000);
    expect(watch).toHaveBeenCalledTimes(1);

    const armed = fakeWatch(0);
    const stop2 = watchAgentSession('/d', onChange, armed.watch as never);
    stop2();
    armed.watchers[0]!.fire();
    armed.watch.mock.calls[0]![2]('change', 'agent.json');
    vi.advanceTimersByTime(10_000);
    expect(armed.watch).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
    expect(watchers).toHaveLength(0);
  });
});
