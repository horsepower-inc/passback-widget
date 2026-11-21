import { readFileSync } from 'node:fs';
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
  // The local Inbox panel shell, loaded on first open by its caller.
  { format: 'iife', outfile: 'dist/passback-panel.js', entry: 'src/inbox-panel.ts', chunk: true },
  // The review session panel and its client; the core loads it only from a review link.
  {
    format: 'iife',
    outfile: 'dist/passback-review-panel.js',
    entry: 'src/review-panel.ts',
    chunk: true,
  },
];

const packageDir = fileURLToPath(new URL('..', import.meta.url));

/** True when the command line asks for a rebuild on each source change. */
export function watchRequested(argv) {
  return argv.includes('--watch');
}

const SAFE_SHA = /^[0-9A-Za-z._-]{1,64}$/;

/** The released version and the commit a build names in its first comment. */
export function buildStamp(env) {
  let version = '0.0.0';
  try {
    const pkgPath = fileURLToPath(new URL('../../next/package.json', import.meta.url));
    const read = JSON.parse(readFileSync(pkgPath, 'utf8')).version;
    if (typeof read === 'string' && read !== '') version = read;
  } catch {
    // missing or unreadable: keep 0.0.0
  }
  const pick = (value) => (typeof value === 'string' && SAFE_SHA.test(value) ? value : undefined);
  const sha = pick(env.PASSBACK_SHA) ?? pick(env.GITHUB_SHA) ?? 'unknown';
  return { version, sha };
}

/** esbuild options for one entry of BUNDLES. */
export function buildOptions(bundle, env = process.env) {
  const { version, sha } = buildStamp(env);
  return {
    banner: { js: `/* passback ${version} ${sha} */` },
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
