import type { Payload } from '@passback/schema';

export const MARK_MAX_BYTES = 50 * 1024;

export type TrimResult = {
  payload: Payload;
  trimmed: Array<'outerHTML' | 'timeline'>;
  fits: boolean;
};

export function payloadBytes(payload: Payload): number {
  return new TextEncoder().encode(JSON.stringify(payload)).length;
}

function withOuterHTML(payload: Payload, outerHTML: string): Payload {
  return { ...payload, element: { ...payload.element, outerHTML } };
}

function trimOuterHTML(payload: Payload, maxBytes: number): Payload {
  const codePoints = Array.from(payload.element.outerHTML);
  let lo = 0;
  let hi = codePoints.length;
  let bestFits = 0;

  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const candidate = withOuterHTML(payload, codePoints.slice(0, mid).join(''));
    if (payloadBytes(candidate) <= maxBytes) {
      bestFits = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  return withOuterHTML(payload, codePoints.slice(0, bestFits).join(''));
}

function trimTimeline(payload: Payload, maxBytes: number): Payload {
  const order = payload.timeline
    .map((event, index) => ({ index, t: event.t }))
    .sort((a, b) => a.t - b.t || a.index - b.index);

  if (order.length === 0) {
    return payload;
  }

  const candidateFor = (removed: number): Payload => {
    const removedIndices = new Set(order.slice(0, removed).map((entry) => entry.index));
    const survivors = payload.timeline.filter((_event, index) => !removedIndices.has(index));
    return { ...payload, timeline: survivors };
  };

  let lo = 1;
  let hi = order.length;
  let best = order.length;

  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (payloadBytes(candidateFor(mid)) <= maxBytes) {
      best = mid;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }

  return candidateFor(best);
}

export function trimPayload(payload: Payload, maxBytes: number = MARK_MAX_BYTES): TrimResult {
  if (payloadBytes(payload) <= maxBytes) {
    return { payload, trimmed: [], fits: true };
  }

  const trimmed: Array<'outerHTML' | 'timeline'> = [];
  let result = trimOuterHTML(payload, maxBytes);
  if (result.element.outerHTML !== payload.element.outerHTML) {
    trimmed.push('outerHTML');
  }

  if (payloadBytes(result) > maxBytes && result.timeline.length > 0) {
    const withTrimmedTimeline = trimTimeline(result, maxBytes);
    if (withTrimmedTimeline.timeline.length < result.timeline.length) {
      trimmed.push('timeline');
    }
    result = withTrimmedTimeline;
  }

  return { payload: result, trimmed, fits: payloadBytes(result) <= maxBytes };
}
