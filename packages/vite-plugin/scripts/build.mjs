import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { copyFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const packageDir = fileURLToPath(new URL('..', import.meta.url));
const widgetDir = fileURLToPath(new URL('../../widget/', import.meta.url));
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

// Every declared dependency stays external, except workspace packages: those are
// TS sources with no build of their own, so they must be bundled in.
const declaredDeps = { ...pkg.dependencies, ...pkg.peerDependencies };
const external = Object.keys(declaredDeps).filter((name) => !name.startsWith('@passback/'));

rmSync(new URL('../dist', import.meta.url), { recursive: true, force: true });

// The widget files are copied into dist/widget, so build them first.
execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: widgetDir, stdio: 'inherit' });

await build({
  absWorkingDir: packageDir,
  entryPoints: ['src/index.ts', 'src/head.ts'],
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external,
});

mkdirSync(new URL('../dist/widget', import.meta.url), { recursive: true });
const widgetFiles = ['passback.js', 'passback-local.js', 'passback-collect.js', 'passback-shot.js'];
for (const file of widgetFiles) {
  copyFileSync(
    new URL(`../../widget/dist/${file}`, import.meta.url),
    new URL(`../dist/widget/${file}`, import.meta.url),
  );
}

// scripts/build.mjs runs with no node_modules/.bin on PATH.
const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');
execFileSync(process.execPath, [tsc, '-p', 'tsconfig.build.json'], {
  cwd: packageDir,
  stdio: 'inherit',
});
