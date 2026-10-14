import { build } from 'esbuild';

import { BUNDLES, buildOptions } from './bundles.mjs';

// one self-contained IIFE, no dependencies, loadable from a <script> tag.
for (const bundle of BUNDLES) {
  await build(buildOptions(bundle));
}
