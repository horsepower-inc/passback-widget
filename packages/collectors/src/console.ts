import type { Entry } from './ring';

export const MESSAGE_MAX = 500;

type ConsoleLevel = 'error' | 'warn';

// `console` is a global, not a member of the DOM `Window` type; this reaches it on the given window.
type WindowWithConsole = Window & Pick<typeof globalThis, 'console'>;

function messagePart(arg: unknown): string {
  if (arg instanceof Error) return arg.message;
  if (typeof arg === 'string') return arg;
  return String(arg);
}

function firstError(args: unknown[]): Error | undefined {
  return args.find((arg): arg is Error => arg instanceof Error);
}

function buildMessage(args: unknown[]): string {
  return args.map(messagePart).join(' ').slice(0, MESSAGE_MAX);
}

function safeRecord(record: () => void): void {
  try {
    record();
  } catch {
    // swallow: the host's call must still complete
  }
}

function wrapConsoleMethod(
  win: Window,
  level: ConsoleLevel,
  push: (entry: Entry) => void,
): () => void {
  const console = (win as WindowWithConsole).console;
  const trueOriginal = console[level];
  const callOriginal = trueOriginal.bind(console);
  let stopped = false;
  const wrapped = (...args: unknown[]): void => {
    if (!stopped) {
      safeRecord(() => {
        const stack = firstError(args)?.stack;
        push({ kind: 'console', level, message: buildMessage(args), ...(stack ? { stack } : {}) });
      });
    }
    callOriginal(...args);
  };
  console[level] = wrapped;
  return () => {
    stopped = true;
    if (console[level] === wrapped) console[level] = trueOriginal;
  };
}

function watchRejections(win: Window, push: (entry: Entry) => void): () => void {
  const onRejection = (event: PromiseRejectionEvent): void => {
    safeRecord(() => {
      const reason: unknown = event.reason;
      const message = buildMessage([reason]);
      const stack = reason instanceof Error ? reason.stack : undefined;
      push({ kind: 'rejection', message, ...(stack ? { stack } : {}) });
    });
  };
  win.addEventListener('unhandledrejection', onRejection);
  return () => win.removeEventListener('unhandledrejection', onRejection);
}

export function watchConsole(win: Window, push: (entry: Entry) => void): () => void {
  const restoreError = wrapConsoleMethod(win, 'error', push);
  const restoreWarn = wrapConsoleMethod(win, 'warn', push);
  const restoreRejections = watchRejections(win, push);

  return () => {
    restoreError();
    restoreWarn();
    restoreRejections();
  };
}
