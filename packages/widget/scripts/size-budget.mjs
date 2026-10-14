import { gzipSync } from 'node:zlib';

/** the widget ships in 20 KB gzipped or it does not ship. */
export const WIDGET_BUDGET_BYTES = 20 * 1024;

/** Gzipped size of a bundle, at the level a CDN would serve it. */
export function gzipSize(source) {
  return gzipSync(source, { level: 9 }).byteLength;
}

/** Verdict for a bundle of `bytes` gzipped against the budget. */
export function checkBudget(bytes) {
  return {
    bytes,
    limit: WIDGET_BUDGET_BYTES,
    ok: bytes <= WIDGET_BUDGET_BYTES,
    overBy: Math.max(0, bytes - WIDGET_BUDGET_BYTES),
  };
}

function kb(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

/** One line for a gate log: what it weighs, what it may weigh, and the margin. */
export function formatBudget(result) {
  const headline = `widget bundle ${kb(result.bytes)} gzipped / ${kb(result.limit)} budget (${result.bytes} of ${result.limit} bytes)`;
  const margin = result.ok ? result.limit - result.bytes : result.overBy;
  const exactMargin = `${margin} ${margin === 1 ? 'byte' : 'bytes'}`;

  return result.ok
    ? `${headline} — within budget, ${exactMargin} to spare`
    : `${headline} — over budget by ${exactMargin}`;
}
