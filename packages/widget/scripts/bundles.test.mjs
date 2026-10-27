import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { gzipSync } from 'node:zlib';

import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';

import { BUNDLES, buildOptions, watchRequested } from './bundles.mjs';

const COLLECTOR_TAILS = ['src/collect.ts', 'src/transport.ts', 'collectors/src/assemble.ts'];
const FX_TAILS = [
  'src/completion.ts',
  'src/fly.ts',
  'src/hide-marks.ts',
  'src/palette.ts',
  'src/rest.ts',
  'src/send-all.ts',
];
const SHOT_TAILS = [
  'src/shot.ts',
  'src/shot-ink.ts',
  'src/shot-veil.ts',
  'src/shot-tools.ts',
  'src/shot-paint.ts',
  'src/shot-grab.ts',
  'src/shot-upload.ts',
  'src/shot-shapes.ts',
  'src/shot-encode.ts',
];

// Output inputs are what ends up in the bundle; metafile.inputs also lists tree-shaken files.
async function bundledInputs(bundle) {
  const result = await build({ ...buildOptions(bundle), write: false, metafile: true });

  return Object.values(result.metafile.outputs).flatMap((output) => Object.keys(output.inputs));
}

function collectorInputs(inputs) {
  return inputs.filter((input) => COLLECTOR_TAILS.some((tail) => input.endsWith(tail)));
}

function fxInputs(inputs) {
  return inputs.filter((input) => FX_TAILS.some((tail) => input.endsWith(tail)));
}

function shotInputs(inputs) {
  return inputs.filter((input) => SHOT_TAILS.some((tail) => input.endsWith(tail)));
}

describe('widget bundles', () => {
  it('ships an IIFE for the script tag and an ES module for npm', () => {
    expect(BUNDLES.map((bundle) => bundle.outfile)).toEqual([
      'dist/passback.js',
      'dist/passback.mjs',
      'dist/passback-local.js',
      'dist/passback-local.mjs',
      'dist/passback-collect.js',
      'dist/passback-shot.js',
    ]);
  });

  it('builds the local pair after the relay pair as passback-local.js and passback-local.mjs', () => {
    const [relayIife, relayEsm, localIife, localEsm] = BUNDLES;

    expect([relayIife.local, relayEsm.local]).toEqual([undefined, undefined]);
    expect(localIife).toMatchObject({
      format: 'iife',
      outfile: 'dist/passback-local.js',
      local: true,
    });
    expect(localEsm).toMatchObject({
      format: 'esm',
      outfile: 'dist/passback-local.mjs',
      local: true,
    });
    expect(buildOptions(localIife).globalName).toBe('Passback');
    expect(buildOptions(localIife).entryPoints).toEqual(['src/index.ts']);
  });

  it('defines __PB_LOCAL__ true for the local pair and false for every other bundle', () => {
    for (const bundle of BUNDLES) {
      expect(buildOptions(bundle).define).toEqual({
        __PB_LOCAL__: bundle.local ? 'true' : 'false',
      });
    }
  });

  it('keeps a __PB_LOCAL__ branch in the local build and removes it from the relay build and the chunks', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pb-local-proof-'));
    const entry = join(dir, 'proof.ts');

    writeFileSync(
      entry,
      "declare const __PB_LOCAL__: boolean;\nif (__PB_LOCAL__) { console.log('pb-local-proof'); }\n",
    );

    try {
      for (const bundle of BUNDLES) {
        const result = await build({ ...buildOptions(bundle), entryPoints: [entry], write: false });
        const text = result.outputFiles[0].text;

        expect(text.includes('pb-local-proof'), bundle.outfile).toBe(Boolean(bundle.local));
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('builds the collector chunk from src/collect.ts as an IIFE without a global name', () => {
    const chunk = BUNDLES.find((bundle) => bundle.outfile === 'dist/passback-collect.js');
    const options = buildOptions(chunk);

    expect(chunk.format).toBe('iife');
    expect(options.entryPoints).toEqual(['src/collect.ts']);
    expect(options.globalName).toBeUndefined();
  });

  it('keeps the collector out of both core bundles', async () => {
    for (const bundle of BUNDLES.filter((candidate) => !candidate.chunk)) {
      expect(collectorInputs(await bundledInputs(bundle))).toEqual([]);
    }
  });

  it('names the global Passback on the IIFE only', () => {
    const [iife, esm] = BUNDLES;

    expect(buildOptions(iife).globalName).toBe('Passback');
    expect(buildOptions(esm).globalName).toBeUndefined();
  });

  it('resolves the entry from the package directory', () => {
    const packageDir = fileURLToPath(new URL('..', import.meta.url));

    expect(buildOptions(BUNDLES[0]).absWorkingDir).toBe(packageDir);
  });

  it('bundles every import, so the ES module imports nothing at runtime', async () => {
    const esm = BUNDLES.find((bundle) => bundle.format === 'esm');
    const result = await build({ ...buildOptions(esm), write: false, metafile: true });
    const [output] = Object.values(result.metafile.outputs);

    expect(output.imports).toEqual([]);
  });
});

describe('watch mode', () => {
  it('asks for watch mode only when --watch is on the command line', () => {
    expect(watchRequested(['--watch'])).toBe(true);
    expect(watchRequested(['--minify', '--watch'])).toBe(true);
    expect(watchRequested([])).toBe(false);
    expect(watchRequested(['--watcher', 'watch'])).toBe(false);
  });
});

describe('shot chunk', () => {
  it('builds the shot chunk from src/shot.ts as an IIFE without a global name', () => {
    const chunk = BUNDLES.find((bundle) => bundle.outfile === 'dist/passback-shot.js');
    const options = buildOptions(chunk);

    expect(chunk.format).toBe('iife');
    expect(options.entryPoints).toEqual(['src/shot.ts']);
    expect(options.globalName).toBeUndefined();
  });

  it('keeps the drawing and capture code out of both core bundles and out of the collect chunk', async () => {
    for (const bundle of BUNDLES.filter(
      (candidate) => candidate.outfile !== 'dist/passback-shot.js',
    )) {
      expect(shotInputs(await bundledInputs(bundle))).toEqual([]);
    }
  });
});

describe('effects chunk', () => {
  it('keeps the celebration and the flight out of both core bundles', async () => {
    for (const bundle of BUNDLES.filter((candidate) => !candidate.chunk)) {
      expect(fxInputs(await bundledInputs(bundle))).toEqual([]);
    }
  });

  it('registers the effects in the collector chunk', async () => {
    const chunk = BUNDLES.find((bundle) => bundle.outfile === 'dist/passback-collect.js');
    const found = fxInputs(await bundledInputs(chunk));

    expect(FX_TAILS.every((tail) => found.some((input) => input.endsWith(tail)))).toBe(true);
  });
});

describe('relay build size', () => {
  const [relayIife, relayEsm, localIife, localEsm] = BUNDLES;

  async function measured(bundle) {
    const result = await build({ ...buildOptions(bundle), write: false, metafile: true });

    return { result, gzipped: gzipSync(result.outputFiles[0].contents, { level: 9 }).length };
  }

  function bytesOf(result, tail) {
    return Object.values(result.metafile.outputs)
      .flatMap((output) => Object.entries(output.inputs))
      .filter(([input]) => input.endsWith(tail))
      .reduce((sum, [, info]) => sum + info.bytesInOutput, 0);
  }

  it('keeps both relay bundles at least 1500 bytes under the 20 KB cap', async () => {
    for (const bundle of [relayIife, relayEsm]) {
      const { gzipped } = await measured(bundle);

      expect(gzipped, bundle.outfile).toBeLessThanOrEqual(20480 - 1500);
    }
  });

  it('leaves the HMR watcher and the reopen port out of the relay bundles and keeps them in the local bundles', async () => {
    for (const bundle of [relayIife, relayEsm]) {
      const { result } = await measured(bundle);

      expect(bytesOf(result, 'src/hmr.ts'), bundle.outfile).toBe(0);
      expect(bytesOf(result, 'src/reopen.ts'), bundle.outfile).toBe(0);
    }
    for (const bundle of [localIife, localEsm]) {
      const { result } = await measured(bundle);

      expect(bytesOf(result, 'src/hmr.ts'), bundle.outfile).toBeGreaterThan(0);
      expect(bytesOf(result, 'src/reopen.ts'), bundle.outfile).toBeGreaterThan(0);
    }
  });
});
