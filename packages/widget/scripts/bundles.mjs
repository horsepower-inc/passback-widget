import { fileURLToPath } from 'node:url';

// the widget loads via <script> (IIFE) and npm (ES module).
export const BUNDLES = [
  { format: 'iife', outfile: 'dist/passback.js' },
  { format: 'esm', outfile: 'dist/passback.mjs' },
  // The lazy collector chunk, injected by the core as a plain <script> tag.
  { format: 'iife', outfile: 'dist/passback-collect.js', entry: 'src/collect.ts', chunk: true },
  // The lazy drawing and capture chunk, injected by the core as a plain <script> tag.
  { format: 'iife', outfile: 'dist/passback-shot.js', entry: 'src/shot.ts', chunk: true },
];

const packageDir = fileURLToPath(new URL('..', import.meta.url));

/** esbuild options for one entry of BUNDLES. */
export function buildOptions(bundle) {
  return {
    absWorkingDir: packageDir,
    entryPoints: [bundle.entry ?? 'src/index.ts'],
    outfile: bundle.outfile,
    bundle: true,
    minify: true,
    format: bundle.format,
    target: ['es2020'],
    legalComments: 'none',
    ...(bundle.format === 'iife' && !bundle.chunk ?{ globalName: 'Passback' } : {}),
  };
}
