import { build, context } from 'esbuild';

import { BUNDLES, buildOptions, watchRequested } from './bundles.mjs';

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
