import { describe, expect, it } from 'vitest';
import type { Payload } from '@passback/schema';
import { MARK_MAX_BYTES, payloadBytes, trimPayload } from './trim';

const REACT_PATH = Array.from({ length: 40 }, (_, i) => `Component${i}`).join(' > ');

function payload(html: string): Payload {
  return {
    element: {
      tag: 'div',
      attrs: {},
      text: '',
      outerHTML: html,
      selectors: [
        { kind: 'react', value: REACT_PATH },
        { kind: 'css', value: 'div' },
      ],
    },
    timeline: [],
  } as unknown as Payload;
}

describe('trimPayload react entry', () => {
  it('keeps the full React path when trimming the HTML and timeline is enough', () => {
    const result = trimPayload(payload('x'.repeat(MARK_MAX_BYTES * 2)));
    expect(result.fits).toBe(true);
    expect(result.trimmed).toEqual(['outerHTML']);
    expect(result.payload.element.selectors[0]).toEqual({ kind: 'react', value: REACT_PATH });
  });

  it('drops the React entry as the last step when the mark still does not fit', () => {
    const base = payload('');
    const withoutReact = {
      ...base,
      element: { ...base.element, selectors: [{ kind: 'css', value: 'div' }] },
    } as Payload;
    const budget = payloadBytes(withoutReact) + 2;
    expect(payloadBytes(base)).toBeGreaterThan(budget);
    const result = trimPayload(payload('x'.repeat(500)), budget);
    // A smaller budget (the widget's batch fitter) never drops the path.
    expect(result.trimmed).not.toContain('react');
    expect(result.payload.element.selectors[0]?.kind).toBe('react');

    const big = payload('');
    big.element.selectors[0] = { kind: 'react', value: 'A'.repeat(MARK_MAX_BYTES + 10) } as never;
    const dropped = trimPayload(big);
    expect(dropped.trimmed).toEqual(['react']);
    expect(dropped.fits).toBe(true);
    expect(dropped.payload.element.selectors).toEqual([{ kind: 'css', value: 'div' }]);
  });
});
