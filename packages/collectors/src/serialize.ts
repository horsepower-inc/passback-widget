export const SECRET_KEY = /token|secret|passw(or)?d|authorization|cookie|api[-_]?key/i;
export const PROPS_MAX_DEPTH = 3;
export const PROPS_MAX_CHARS = 2048;

const REDACTED = '[redacted]';
const INPUT_VALUE_KEY = /^(value|defaultValue)$/i;

function isDomNode(value: object): boolean {
  return typeof Node !== 'undefined' && value instanceof Node;
}

function isReactElement(value: object): boolean {
  return '$$typeof' in value;
}

function serializeObject(
  value: object,
  depth: number,
  maxDepth: number,
  seen: ReadonlySet<object>,
): unknown {
  if (seen.has(value)) return '[circular]';
  if (depth >= maxDepth) return '[depth]';

  const nextSeen = new Set(seen).add(value);

  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (let i = 0; i < value.length; i += 1) {
      try {
        out.push(serializeValue(value[i], depth + 1, maxDepth, nextSeen));
      } catch {
        out.push('[unavailable]');
      }
    }
    return out;
  }

  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    if (SECRET_KEY.test(key) || INPUT_VALUE_KEY.test(key)) {
      out[key] = REDACTED;
      continue;
    }
    try {
      out[key] = serializeValue(
        (value as Record<string, unknown>)[key],
        depth + 1,
        maxDepth,
        nextSeen,
      );
    } catch {
      out[key] = '[unavailable]';
    }
  }
  return out;
}

function serializeValue(
  value: unknown,
  depth: number,
  maxDepth: number,
  seen: ReadonlySet<object>,
): unknown {
  if (typeof value === 'function') return '[function]';
  if (typeof value === 'bigint' || typeof value === 'symbol') return String(value);
  if (value === null || typeof value !== 'object') return value;
  if (isDomNode(value)) return '[node]';
  if (isReactElement(value)) return '[element]';
  return serializeObject(value, depth, maxDepth, seen);
}

/** Recursively strips functions, DOM nodes, React elements, cycles and secrets; the result is cut to `maxChars` JSON characters when it would be longer. */
export function toSafeJson(
  value: unknown,
  maxDepth = PROPS_MAX_DEPTH,
  maxChars = PROPS_MAX_CHARS,
): unknown {
  const result = serializeValue(value, 0, maxDepth, new Set());
  const json = JSON.stringify(result);
  if (json !== undefined && json.length > maxChars) return json.slice(0, maxChars);
  return result;
}
