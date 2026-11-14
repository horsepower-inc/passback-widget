import { loadRegistered, readScriptConfig } from './collector-loader';
import { reviewOf } from './review-link';
import type { ReviewActivate, ReviewActivateOptions } from './review-panel';

export type ReviewStartOptions = Omit<ReviewActivateOptions, 'endpoint'> & {
  doc: Document;
  unmount(): void;
};

/**
 * Core side of a review link: loads the review chunk once and activates it; a page with no link gets nothing at all.
 * Returns the widget's unmount, with stopping the review folded in. Any failure leaves the normal widget.
 */
export function startReview({ doc, unmount, ...opts }: ReviewStartOptions): () => void {
  const { chunkSrc, endpoint } = readScriptConfig(doc);
  if (!reviewOf(opts.win) || !chunkSrc || !endpoint) return unmount;
  let stop: (() => void) | undefined = unmount;
  const src = () => new URL('passback-review-panel.js', new URL(chunkSrc, doc.baseURI)).href;
  loadRegistered<ReviewActivate>(doc, opts.win, 'reviewActivate', 'review', src)
    .then((activate) => {
      if (!stop) return;
      const stopSession = activate({ ...opts, endpoint });
      stop = () => (stopSession(), unmount());
    })
    .catch(() => undefined);
  return () => {
    stop?.();
    stop = undefined;
  };
}
