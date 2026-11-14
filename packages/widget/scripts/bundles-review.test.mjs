import { gzipSync } from 'node:zlib';

import { build } from 'esbuild';
import { Window } from 'happy-dom';
import { describe, expect, it, vi } from 'vitest';

import { BUNDLES, buildOptions } from './bundles.mjs';

const REVIEW = 'dist/passback-review-panel.js';
const capFor = (b) => (b.chunk ? 32 * 1024 : b.local ? 64 * 1024 : 20 * 1024 - 900);

describe('review session bundle', () => {
  it('ships the dormant session client only in the review chunk within budget', async () => {
    let chunk = '';
    for (const bundle of BUNDLES) {
      const result = await build({ ...buildOptions(bundle), write: false, metafile: true });
      const { text, contents } = result.outputFiles[0];
      const inputs = Object.values(result.metafile.outputs).flatMap((o) => Object.keys(o.inputs));
      const own = inputs.filter((input) => input.endsWith('src/review-session.ts')).length;
      const review = bundle.outfile === REVIEW;
      if (review) chunk = text;
      expect(own, bundle.outfile).toBe(review ? 1 : 0);
      for (const marker of ['/review/', 'review_not_found', 'review:']) {
        expect(text.includes(marker), `${bundle.outfile} ${marker}`).toBe(review);
      }
      expect(gzipSync(contents, { level: 9 }).length, bundle.outfile).toBeLessThanOrEqual(
        capFor(bundle),
      );
    }

    const win = new Window();
    const shot = () => undefined;
    const untouched = vi.fn();
    win.__passback = { shot };
    Object.assign(win, {
      fetch: untouched,
      XMLHttpRequest: untouched,
      setTimeout: untouched,
      setInterval: untouched,
    });
    Object.defineProperty(win, 'sessionStorage', { get: untouched });
    const before = win.document.documentElement.outerHTML;
    try {
      win.eval(chunk);
      expect(typeof win.__passback.reviewPanel).toBe('function');
      expect(typeof win.__passback.reviewSession).toBe('function');
      expect(win.__passback.shot).toBe(shot);
      expect(win.document.documentElement.outerHTML).toBe(before);
      expect(untouched).not.toHaveBeenCalled();
    } finally {
      await win.happyDOM.close();
    }
  });
});
