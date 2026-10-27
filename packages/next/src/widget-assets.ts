// the widget bundle and collector chunk the route handler serves.

import { readWidgetFile } from '@passback/vite-plugin/assets';

export type WidgetAssets = { widget: Buffer; collector: Buffer; shot: Buffer };

/** Reads the three files through the vite-plugin resolver on every call, so a rebuilt widget is served
 * without restarting `next dev`. `local` picks the local build, which keeps the hot bridge the dev
 * shim feeds; the relay build drops it. Resolver errors propagate unchanged. */
export function readWidgetAssets(
  from: string | URL = import.meta.url,
  local = false,
): WidgetAssets {
  return {
    widget: readWidgetFile(local ? 'passback-local.js' : 'passback.js', from).bytes,
    collector: readWidgetFile('passback-collect.js', from).bytes,
    shot: readWidgetFile('passback-shot.js', from).bytes,
  };
}
