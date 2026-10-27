import { describe, expect, it } from 'vitest';

import {
  LAZY_CHUNK_BUDGET_BYTES,
  LOCAL_WIDGET_BUDGET_BYTES,
  WIDGET_BUDGET_BYTES,
  checkBudget,
  formatBudget,
  gzipSize,
} from './size-budget.mjs';

describe('widget size budget', () => {
  it('is 20 KB gzipped, the size budget', () => {
    expect(WIDGET_BUDGET_BYTES).toBe(20 * 1024);
  });

  it('budgets a lazy chunk at 32 KB', () => {
    expect(LAZY_CHUNK_BUDGET_BYTES).toBe(32 * 1024);
    expect(checkBudget(20552, LAZY_CHUNK_BUDGET_BYTES).ok).toBe(true);
    expect(checkBudget(32769, LAZY_CHUNK_BUDGET_BYTES).overBy).toBe(1);
  });

  it('budgets the local build at 64 KB', () => {
    expect(LOCAL_WIDGET_BUDGET_BYTES).toBe(64 * 1024);
    expect(checkBudget(40000, LOCAL_WIDGET_BUDGET_BYTES).ok).toBe(true);
    expect(checkBudget(64 * 1024 + 1, LOCAL_WIDGET_BUDGET_BYTES).overBy).toBe(1);
  });

  it('checks a bundle against the limit it is given', () => {
    expect(checkBudget(20552).ok).toBe(false);
    expect(checkBudget(20552, 21 * 1024)).toMatchObject({ limit: 21 * 1024, ok: true, overBy: 0 });
  });

  it('passes a bundle under the budget', () => {
    const result = checkBudget(9000);

    expect(result.ok).toBe(true);
    expect(result.overBy).toBe(0);
  });

  it('passes a bundle exactly on the budget', () => {
    expect(checkBudget(20480).ok).toBe(true);
  });

  it('fails a bundle over the budget and reports the overshoot', () => {
    const result = checkBudget(20481);

    expect(result.ok).toBe(false);
    expect(result.overBy).toBe(1);
  });

  it('measures gzipped bytes, not raw bytes', () => {
    const source = Buffer.from('passback widget '.repeat(2000));

    expect(gzipSize(source)).toBeLessThan(source.byteLength);
  });

  it('says how far over budget a failing bundle is', () => {
    const message = formatBudget(checkBudget(21504));

    expect(message).toContain('21.0 KB');
    expect(message).toContain('20.0 KB');
    expect(message).toContain('over budget');
  });

  it('reports the headroom left on a passing bundle', () => {
    expect(formatBudget(checkBudget(5120))).toContain('within budget');
  });
});

describe('widget size budget exact bytes', () => {
  it('reports the exact bytes left on a passing bundle', () => {
    const message = formatBudget(checkBudget(20458));

    expect(message).toContain('(20458 of 20480 bytes)');
    expect(message).toContain('22 bytes to spare');
  });

  it('reports the exact bytes over on a failing bundle', () => {
    const message = formatBudget(checkBudget(20484));

    expect(message).toContain('(20484 of 20480 bytes)');
    expect(message).toContain('over budget by 4 bytes');
  });

  it('says 1 byte, not 1 bytes', () => {
    const message = formatBudget(checkBudget(20481));

    expect(message).toContain('over budget by 1 byte');
    expect(message).not.toContain('1 bytes');
  });
});
