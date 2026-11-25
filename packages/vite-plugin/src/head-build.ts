// Staging-build half of `@passback/vite-plugin/head`: the head module is generated before the
// widget assets are emitted, so it names them by token and generateBundle swaps in the real files.

import type { Rollup } from 'vite';
import { readWidgetArtifact, WIDGET_ASSET_NAME } from './widget-bundle';
import { CHUNK_ASSET_NAME, readChunkArtifact } from './widget-chunk';

export const WIDGET_TOKEN = '__PASSBACK_ASSET_WIDGET__';
export const COLLECTOR_TOKEN = '__PASSBACK_ASSET_COLLECTOR__';
export const SHOT_TOKEN = '__PASSBACK_ASSET_SHOT__';

export type BundleEmitter = {
  emitFile(file: { type: 'asset'; name: string; source: Buffer }): string;
  getFileName(refId: string): string;
};

export type WidgetAssetFiles = { widgetFile: string; chunkFile: string; shotFile?: string };

export function emitWidgetAsset(ctx: BundleEmitter): WidgetAssetFiles {
  const { bytes } = readWidgetArtifact();
  const widgetRef = ctx.emitFile({ type: 'asset', name: WIDGET_ASSET_NAME, source: bytes });
  const chunkRef = ctx.emitFile({
    type: 'asset',
    name: CHUNK_ASSET_NAME,
    source: readChunkArtifact().bytes,
  });
  return { widgetFile: ctx.getFileName(widgetRef), chunkFile: ctx.getFileName(chunkRef) };
}

/** What the head module is generated with: the shot token only when the build ships it, and the
 * root for a relative base, which a page the helper knows nothing about cannot resolve. */
export function headTokens(base: string, shot: boolean) {
  const files: WidgetAssetFiles = {
    widgetFile: WIDGET_TOKEN,
    chunkFile: COLLECTOR_TOKEN,
    shotFile: shot ? SHOT_TOKEN : undefined,
  };
  return { files, base: base === './' || base === '' ? '/' : base };
}

/** Replaces every token in the code of every output chunk; assets are left as emitted. */
export function replaceAssetTokens(bundle: Rollup.OutputBundle, files: WidgetAssetFiles): void {
  const pairs: [string, string | undefined][] = [
    [WIDGET_TOKEN, files.widgetFile],
    [COLLECTOR_TOKEN, files.chunkFile],
    [SHOT_TOKEN, files.shotFile],
  ];
  for (const output of Object.values(bundle)) {
    if (output.type !== 'chunk') continue;
    for (const [token, file] of pairs) {
      if (file !== undefined) output.code = output.code.split(token).join(file);
    }
  }
}
