import { describe, expect, it, vi } from 'vitest';
import type { ResolveTarget } from '@passback/collectors';
import { startVerify } from './verify-proposed';

const target = {} as ResolveTarget;
const ANN = [{ type: 'no-overlap', elements: ['self', 'prev'] }];

function setup(opts: { caps?: unknown; verdict?: () => string; send?: () => void } = {}) {
  const handlers: ((d: unknown) => void)[] = [];
  const hot = {
    on: vi.fn((_e: string, cb: (d: unknown) => void) => void handlers.push(cb)),
    off: vi.fn(),
    send: vi.fn(opts.send ?? (() => {})),
  };
  const measure = vi.fn(opts.verdict ?? (() => 'closed'));
  const verify = startVerify({
    hot,
    caps: 'caps' in opts ? opts.caps : ['verified'],
    marks: () => [
      { id: 'a', target },
      { id: 'b', target },
    ],
    measure: measure as never,
  });
  const push = (items: unknown[]) => handlers.forEach((h) => h({ v: 1, items }));
  return { hot, measure, verify, push };
}

describe('startVerify', () => {
  it('sends one passback:verified for a proposed mark whose annotations hold', () => {
    const { hot, push } = setup();
    push([
      { id: 'a', status: 'proposed', annotations: ANN },
      { id: 'b', status: 'proposed', annotations: ANN },
    ]);
    expect(hot.send).toHaveBeenCalledTimes(1);
    expect(hot.send).toHaveBeenCalledWith('passback:verified', { v: 1, markIds: ['a', 'b'] });
  });

  it('sends nothing for open, unchecked, unknown or non-proposed marks', () => {
    for (const verdict of ['open', 'unchecked']) {
      const { hot, push } = setup({ verdict: () => verdict });
      push([{ id: 'a', status: 'proposed', annotations: ANN }]);
      expect(hot.send).not.toHaveBeenCalled();
    }
    const { hot, push, measure } = setup();
    push([
      { id: 'zzz', status: 'proposed', annotations: ANN },
      { id: 'a', status: 'open', annotations: ANN },
      { id: 'b', status: 'proposed', annotations: [] },
    ]);
    expect(measure).not.toHaveBeenCalled();
    expect(hot.send).not.toHaveBeenCalled();
  });

  it('sends each mark id once per page load, and again after a failed send', () => {
    let fail = true;
    const { hot, push, verify } = setup({
      send: () => {
        if (fail) throw new Error('down');
      },
    });
    const items = [{ id: 'a', status: 'proposed', annotations: ANN }];
    push(items);
    fail = false;
    verify.run();
    verify.run();
    push(items);
    expect(hot.send).toHaveBeenCalledTimes(2);
  });

  it('does nothing without the verified capability or without a hot object', () => {
    const { hot, verify } = setup({ caps: ['reopen'] });
    verify.run();
    verify.stop();
    expect(hot.on).not.toHaveBeenCalled();
    const none = startVerify({
      hot: undefined,
      caps: ['verified'],
      marks: () => [],
      measure: () => 'closed',
    });
    expect(() => (none.run(), none.stop())).not.toThrow();
    expect(setup({ caps: undefined }).hot.on).not.toHaveBeenCalled();
  });

  it('measures again when run is called after an HMR update', () => {
    let verdict = 'open';
    const { hot, push, verify, measure } = setup({ verdict: () => verdict });
    push([{ id: 'a', status: 'proposed', annotations: ANN }]);
    expect(hot.send).not.toHaveBeenCalled();
    verdict = 'closed';
    verify.run();
    expect(measure).toHaveBeenCalledTimes(2);
    expect(hot.send).toHaveBeenCalledWith('passback:verified', { v: 1, markIds: ['a'] });
  });

  it('stops listening on stop', () => {
    const { hot, verify } = setup();
    verify.stop();
    expect(hot.off).toHaveBeenCalledWith('passback:items', hot.on.mock.calls[0]![1]);
  });

  it('never throws when the hot object refuses the subscription', () => {
    const hot = {
      on: () => {
        throw new Error('no channel');
      },
      send: vi.fn(),
    };
    const start = () =>
      startVerify({ hot, caps: ['verified'], marks: () => [], measure: () => 'closed' });
    expect(start).not.toThrow();
    const verify = start();
    expect(() => (verify.run(), verify.stop())).not.toThrow();
  });
});
