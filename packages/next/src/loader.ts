import path from 'node:path';
import { formatLoc, injectSource } from '@passback/vite-plugin/source';

export type PassbackLoaderOptions = { root: string };
export type LoaderContext = {
  resourcePath: string;
  getOptions(): PassbackLoaderOptions;
  callback(error: Error | null, content?: string, sourceMap?: unknown): void;
};

export default function passbackLoader(this: LoaderContext, source: string): void {
  const file = this.resourcePath.split('?')[0] ?? '';
  const root = this.getOptions().root;
  const rel = path.relative(root, file);

  if (
    !/\.(jsx|tsx)$/.test(file) ||
    /[\\/]node_modules[\\/]/.test(file) ||
    rel.startsWith('..') ||
    path.isAbsolute(rel)
  ) {
    this.callback(null, source);
    return;
  }

  const result = injectSource(source, rel.split(path.sep).join('/'), formatLoc);
  if (!result) {
    this.callback(null, source);
    return;
  }

  const map = JSON.parse(result.map.toString()) as { sources: string[] };
  map.sources = [file];
  this.callback(null, result.code, map);
}
