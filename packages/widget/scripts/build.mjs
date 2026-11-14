import { copyFile, mkdir } from 'node:fs/promises';

import { build, context } from 'esbuild';

import { BUNDLES, buildOptions, watchRequested } from './bundles.mjs';

// The settings inventory ships beside the bundles; copy it before any esbuild work.
const settingsDest = new URL('../dist/settings.json', import.meta.url);
await mkdir(new URL('.', settingsDest), { recursive: true });
await copyFile(new URL('../settings.json', import.meta.url), settingsDest);

// one self-contained IIFE, no dependencies, loadable from a <script> tag.
if (watchRequested(process.argv.slice(2))) {
  const contexts = await Promise.all(BUNDLES.map((bundle) => context(buildOptions(bundle))));

  await Promise.all(contexts.map((ctx) => ctx.watch()));
  console.log('watching packages/widget/src (Ctrl-C to stop)');
} else {
  for (const bundle of BUNDLES) {
    await build(buildOptions(bundle));
  }
}
