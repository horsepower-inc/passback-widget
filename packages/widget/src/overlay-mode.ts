import type { Collector, CollectOptions } from './collect';

export const LOAD_FAILED = 'Passback could not finish loading.';

export type OverlayMode = { ready(): Promise<Collector>; relay(): boolean };

/** Readiness keeps the lazy load; relay is synchronous and never loads: the collector's own value once it exists, else `!hot`. */
export function overlayModeOf(
  collector: () => Collector | null,
  hot: CollectOptions['hot'],
  load: () => Promise<Collector>,
): OverlayMode {
  return {
    ready: () =>
      load().catch(() => {
        throw new Error(LOAD_FAILED);
      }),
    relay: () => collector()?.relay ?? !hot,
  };
}
