import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const packageDir = fileURLToPath(new URL('..', import.meta.url));
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

// Every declared dependency stays external, except workspace packages: those are
// TS sources with no build of their own, so they must be bundled in.
const declaredDeps = { ...pkg.dependencies, ...pkg.peerDependencies };
const external = Object.keys(declaredDeps).filter((name) => !name.startsWith('@passback/'));

const ENTRIES = [
  { in: 'src/index.ts', out: 'index' },
  { in: 'src/bin.ts', out: 'bin' },
];

await build({
  absWorkingDir: packageDir,
  entryPoints: ENTRIES,
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external,
});

// scripts/build.mjs runs with no node_modules/.bin on PATH.
const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');
execFileSync(process.execPath, [tsc, '-p', 'tsconfig.build.json'], {
  cwd: packageDir,
  stdio: 'inherit',
});
