import { gzipSync } from 'node:zlib';

/** the widget core ships in 20 KB gzipped or it does not ship. */
export const WIDGET_BUDGET_BYTES = 20 * 1024;

/** 04 Decisions 2026-10-20: each lazy chunk (collector, shot) has its own 32 KB gzipped budget; the core keeps 20 KB. */
export const LAZY_CHUNK_BUDGET_BYTES = 32 * 1024;

/** 2026-10-25: the local build (dist/passback-local.*) has its own 64 KB gzipped budget; the relay build keeps 20 KB. */
export const LOCAL_WIDGET_BUDGET_BYTES = 64 * 1024;

/** Gzipped size of a bundle, at the level a CDN would serve it. */
export function gzipSize(source) {
  return gzipSync(source, { level: 9 }).byteLength;
}

/** Verdict for a bundle of `bytes` gzipped against `limit` (the core budget unless the caller names another). */
export function checkBudget(bytes, limit = WIDGET_BUDGET_BYTES) {
  return {
    bytes,
    limit,
    ok: bytes <= limit,
    overBy: Math.max(0, bytes - limit),
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
