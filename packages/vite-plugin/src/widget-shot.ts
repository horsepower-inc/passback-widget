// emits the drawing chunk with a relay build that has screenshots on
// and names it on the widget's script tag via `data-passback-shot`.

import type { HtmlTagDescriptor } from 'vite';
import { readWidgetFile } from './widget-artifact';

export const SHOT_ASSET_NAME = 'shot.js';

type ShotEmitter = {
  emitFile(file: { type: 'asset'; name: string; source: Buffer }): string;
  getFileName(refId: string): string;
};

/** Whether the build ships the shot chunk: a relay build (it has an endpoint) with screenshots on,
 * by the same default as `shotAttrs`. An agent build keeps pictures on the dev server only. */
export function shotBuilt(
  state: { endpoint: string | undefined },
  screenshots: boolean | undefined,
): boolean {
  return state.endpoint !== undefined && (screenshots ?? true);
}

/** Emits the shot chunk as `shot-<hash>.js` and returns its built file name; `undefined` when off. */
export function emitShotAsset(ctx: ShotEmitter, on: boolean): string | undefined {
  if (!on) return undefined;
  const source = readWidgetFile('passback-shot.js').bytes;
  return ctx.getFileName(ctx.emitFile({ type: 'asset', name: SHOT_ASSET_NAME, source }));
}

/** The tag with `data-passback-shot` added; unchanged when there is no shot chunk. */
export function withShotSrc(
  tag: HtmlTagDescriptor,
  shotSrc: string | undefined,
): HtmlTagDescriptor {
  if (shotSrc === undefined) return tag;
  const attrs = typeof tag.attrs === 'object' ? tag.attrs : {};
  return { ...tag, attrs: { ...attrs, 'data-passback-shot': shotSrc } };
}
