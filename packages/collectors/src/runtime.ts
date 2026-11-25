import type { Runtime } from '@passback/schema';
import { redactSegment } from './element';
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

// Shallow (depth 2) and capped at 500 UTF-8 bytes of JSON: oversized props are omitted, never sliced.
function collectProps(el: Element): unknown {
  const fiber = nearestComponentFiber(el);
  const props = fiber ? toSafeJson(fiber.memoizedProps, 2, Infinity) : undefined;
  return new TextEncoder().encode(String(JSON.stringify(props))).length <= 500 ? props : undefined;
}

function collectFlags(getters: RuntimeGetters): Record<string, boolean> | undefined {
  const raw = safeCall(getters.flags);
  if (raw === undefined) return undefined;
  return Object.fromEntries(
    Object.entries(raw).filter(([, value]) => typeof value === 'boolean'),
  ) as Record<string, boolean>;
}

function collectRole(getters: RuntimeGetters): string | undefined {
  const role = safeCall(getters.role);
  return typeof role === 'string' ? role : undefined;
}

// Key names only: values are never read. Blocked or failing storage throws, and the field is omitted.
function collectStorage(win: Window): Runtime['storage'] {
  try {
    const [local, session] = [win.localStorage, win.sessionStorage].map((store) =>
      // Default sort is by UTF-16 code unit: locale-independent. Redact before the cut (see redactSegment).
      Array.from({ length: store.length }, (_, i) => store.key(i))
        .filter((name): name is string => name !== null)
        .sort()
        .slice(0, 50)
        .map((name) => redactSegment(name, 100)),
    ) as [string[], string[]];
    return local.length || session.length ? { local, session } : undefined;
  } catch {
    return undefined;
  }
}

export function collectRuntime(el: Element, win: Window, getters: RuntimeGetters = {}): Runtime {
  const fields: Record<string, unknown> = {
    url: safeUrl(win),
    route: routePattern(win),
    props: collectProps(el),
    store: toSafeJson(safeCall(getters.store)),
    flags: collectFlags(getters),
    role: collectRole(getters),
    storage: collectStorage(win),
  };
  // Optional fields are omitted, never undefined or null.
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined),
  ) as unknown as Runtime;
}
