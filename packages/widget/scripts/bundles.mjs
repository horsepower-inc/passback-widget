import { fileURLToPath } from 'node:url';

// the widget loads via <script> (IIFE) and npm (ES module).
export const BUNDLES = [
  { format: 'iife', outfile: 'dist/passback.js' },
  { format: 'esm', outfile: 'dist/passback.mjs' },
  // The local build (Vite plugin, next dev): same source, __PB_LOCAL__ true, its own 64 KB budget.
  { format: 'iife', outfile: 'dist/passback-local.js', local: true },
  { format: 'esm', outfile: 'dist/passback-local.mjs', local: true },
  // The lazy collector chunk, injected by the core as a plain <script> tag.
  { format: 'iife', outfile: 'dist/passback-collect.js', entry: 'src/collect.ts', chunk: true },
  // The lazy drawing and capture chunk, injected by the core as a plain <script> tag.
  { format: 'iife', outfile: 'dist/passback-shot.js', entry: 'src/shot.ts', chunk: true },
];

const packageDir = fileURLToPath(new URL('..', import.meta.url));

/** True when the command line asks for a rebuild on each source change. */
export function watchRequested(argv) {
  return argv.includes('--watch');
}

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
    define: { __PB_LOCAL__: bundle.local ? 'true' : 'false' },
    ...(bundle.format === 'iife' && !bundle.chunk ? { globalName: 'Passback' } : {}),
  };
}
