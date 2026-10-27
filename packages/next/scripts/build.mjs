import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const packageDir = fileURLToPath(new URL('..', import.meta.url));
const widgetDir = fileURLToPath(new URL('../../widget/', import.meta.url));

rmSync(new URL('../dist', import.meta.url), { recursive: true, force: true });

// The widget files are copied into dist/widget, so build them first.
execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: widgetDir, stdio: 'inherit' });

// Next's config loader, webpack's loader runner and the route all load plain Node JavaScript, so
// everything but next and react is bundled in, workspace packages included.
const common = {
  absWorkingDir: packageDir,
  bundle: true,
  platform: 'node',
  target: 'node22',
  external: ['next', 'next/*', 'react', 'react/*'],
};

// Code that locates files next to itself uses import.meta.url, which CommonJS lacks.
const cjs = {
  format: 'cjs',
  define: { 'import.meta.url': '__passbackImportMetaUrl' },
  banner: {
    js: "const __passbackImportMetaUrl = require('node:url').pathToFileURL(__filename).href;",
  },
};

for (const name of ['index', 'route']) {
  await build({
    ...common,
    entryPoints: [`src/${name}.ts`],
    outfile: `dist/${name}.js`,
    format: 'esm',
  });
  await build({ ...common, ...cjs, entryPoints: [`src/${name}.ts`], outfile: `dist/${name}.cjs` });
}

// Webpack's loader runner and Turbopack's loader pool call the module's export as the loader.
await build({
  ...common,
  ...cjs,
  entryPoints: ['src/loader.ts'],
  outfile: 'dist/loader.cjs',
  footer: { js: 'module.exports = module.exports.default;' },
});

mkdirSync(new URL('../dist/widget', import.meta.url), { recursive: true });
for (const file of [
  'passback.js',
  'passback-local.js',
  'passback-collect.js',
  'passback-shot.js',
]) {
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
