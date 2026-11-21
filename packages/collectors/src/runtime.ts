import type { Runtime } from '@passback/schema';
import { nearestComponentFiber } from './react';
import { routePattern, safeUrl } from './route';
import { toSafeJson } from './serialize';

export interface RuntimeGetters {
  readonly flags?: () => Record<string, unknown>;
  readonly role?: () => unknown;
  readonly store?: () => unknown;
}

function safeCall<T>(fn: (() => T) | undefined): T | undefined {
  if (!fn) return undefined;
  try {
    return fn();
  } catch {
    return undefined;
  }
}

function collectProps(el: Element): unknown {
  const fiber = nearestComponentFiber(el);
  return fiber ? toSafeJson(fiber.memoizedProps) : undefined;
}

function collectStore(getters: RuntimeGetters): unknown {
  const store = safeCall(getters.store);
  return store === undefined ? undefined : toSafeJson(store);
}

function collectFlags(getters: RuntimeGetters): Record<string, boolean> | undefined {
  const raw = safeCall(getters.flags);
  if (raw === undefined) return undefined;
  const flags: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'boolean') flags[key] = value;
  }
  return flags;
}

function collectRole(getters: RuntimeGetters): string | undefined {
  const role = safeCall(getters.role);
  return typeof role === 'string' ? role : undefined;
}

export function collectRuntime(el: Element, win: Window, getters: RuntimeGetters = {}): Runtime {
  const runtime: Runtime = {
    url: safeUrl(win),
    route: routePattern(win),
  };

  const props = collectProps(el);
  if (props !== undefined) runtime.props = props;

  const store = collectStore(getters);
  if (store !== undefined) runtime.store = store;

  const flags = collectFlags(getters);
  if (flags !== undefined) runtime.flags = flags;

  const role = collectRole(getters);
  if (role !== undefined) runtime.role = role;

  return runtime;
}
