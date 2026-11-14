// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MESSAGE_MAX, watchConsole } from './console';
import type { Entry } from './ring';

function unhandledRejectionEvent(reason: unknown): PromiseRejectionEvent {
  const event = new Event('unhandledrejection');
  Object.defineProperty(event, 'reason', { value: reason });
  return event as PromiseRejectionEvent;
}

let stop: (() => void) | undefined;
let originalError: ReturnType<typeof vi.fn>;
let originalWarn: ReturnType<typeof vi.fn>;

beforeEach(() => {
  originalError = vi.fn();
  originalWarn = vi.fn();
  window.console.error = originalError;
  window.console.warn = originalWarn;
});

afterEach(() => {
  stop?.();
  stop = undefined;
});

describe('watchConsole', () => {
  it('records console.error with the stack of an Error argument', () => {
    const entries: Entry[] = [];
    const error = new Error('boom');
    stop = watchConsole(window, (entry) => entries.push(entry));

    console.error('failed:', error);

    expect(entries).toEqual([
      { kind: 'console', level: 'error', message: 'failed: boom', stack: error.stack },
    ]);
  });

  it('records console.warn', () => {
    const entries: Entry[] = [];
    stop = watchConsole(window, (entry) => entries.push(entry));

    console.warn('careful');

    expect(entries).toEqual([{ kind: 'console', level: 'warn', message: 'careful' }]);
  });

  it('still calls the original console method', () => {
    stop = watchConsole(window, () => {});

    console.error('hello', 1);

    expect(originalError).toHaveBeenCalledWith('hello', 1);
  });

  it('records an unhandled rejection', () => {
    const entries: Entry[] = [];
    const reason = new Error('rejected');
    stop = watchConsole(window, (entry) => entries.push(entry));

    window.dispatchEvent(unhandledRejectionEvent(reason));

    expect(entries).toEqual([{ kind: 'rejection', message: 'rejected', stack: reason.stack }]);
  });

  it('caps a message at 500 characters', () => {
    const entries: Entry[] = [];
    stop = watchConsole(window, (entry) => entries.push(entry));

    console.error('x'.repeat(MESSAGE_MAX + 100));

    const [entry] = entries;
    expect(entry?.kind === 'console' ? entry.message.length : undefined).toBe(MESSAGE_MAX);
  });
});
