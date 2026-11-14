// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { collectStyles, STYLE_SHORTLIST } from './styles';

describe('collectStyles', () => {
  it('returns only keys from the shortlist', () => {
    document.body.innerHTML =
      '<div id="el" style="color: rgb(17, 24, 39); text-align: center; cursor: pointer;"></div>';
    const el = document.getElementById('el')!;

    const styles = collectStyles(el);

    for (const key of Object.keys(styles)) {
      expect(STYLE_SHORTLIST).toContain(key);
    }
    expect(styles['text-align']).toBeUndefined();
    expect(styles.cursor).toBeUndefined();
    expect(styles.color).toBe('rgb(17, 24, 39)');
  });

  it('reads a declaration from a stylesheet rule', () => {
    document.head.innerHTML = '<style>.title { color: rgb(200, 0, 0); }</style>';
    document.body.innerHTML = '<div id="el" class="title"></div>';
    const el = document.getElementById('el')!;

    const styles = collectStyles(el);

    expect(styles.color).toBe('rgb(200, 0, 0)');
  });

  it('reads longhand margins and paddings', () => {
    document.body.innerHTML =
      '<div id="el" style="margin-top: 4px; margin-right: 8px; margin-bottom: 12px; margin-left: 16px; padding-top: 1px; padding-right: 2px; padding-bottom: 3px; padding-left: 5px;"></div>';
    const el = document.getElementById('el')!;

    const styles = collectStyles(el);

    expect(styles['margin-top']).toBe('4px');
    expect(styles['margin-right']).toBe('8px');
    expect(styles['margin-bottom']).toBe('12px');
    expect(styles['margin-left']).toBe('16px');
    expect(styles['padding-top']).toBe('1px');
    expect(styles['padding-right']).toBe('2px');
    expect(styles['padding-bottom']).toBe('3px');
    expect(styles['padding-left']).toBe('5px');
  });
});
