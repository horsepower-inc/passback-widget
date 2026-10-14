import type { ShotOpen, ShotOutcome } from './shot-loader';

export type SandboxShot = ShotOpen & { sandbox: true };

// For the landing demo: drawing works, Send takes no picture and uploads nothing.
export function sandboxShot(open: ShotOpen): SandboxShot {
  const wrapped: ShotOpen = (options) => {
    const real = open(options);
    return {
      setActive: (on) => real.setActive(on),
      count: () => real.count(),
      finish: () => Promise.resolve<ShotOutcome>({}),
      close: () => real.close(),
    };
  };
  return Object.assign(wrapped, { sandbox: true as const });
}

export function isSandboxShot(value: unknown): value is SandboxShot {
  return typeof value === 'function' && (value as { sandbox?: unknown }).sandbox === true;
}
