import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';

import { BUNDLES, buildOptions, buildStamp } from './bundles.mjs';

const nextPackage = fileURLToPath(new URL('../../next/package.json', import.meta.url));
const version = JSON.parse(readFileSync(nextPackage, 'utf8')).version;

describe('bundle banner', () => {
  it('starts every built bundle with one comment that names the version and the sha', async () => {
    for (const bundle of BUNDLES) {
      const result = await build({
        ...buildOptions(bundle, { PASSBACK_SHA: 'abc1234' }),
        write: false,
      });
      const text = result.outputFiles[0].text;
      expect(text.startsWith(`/* passback ${version} abc1234 */\n`), bundle.outfile).toBe(true);
    }
  });

  it('takes the sha from PASSBACK_SHA, then GITHUB_SHA, and says unknown for a missing or unsafe value', () => {
    expect(buildStamp({ PASSBACK_SHA: 'aaa', GITHUB_SHA: 'bbb' })).toEqual({ version, sha: 'aaa' });
    expect(buildStamp({ GITHUB_SHA: 'bbb' }).sha).toBe('bbb');
    expect(buildStamp({}).sha).toBe('unknown');
    expect(buildStamp({ PASSBACK_SHA: '' }).sha).toBe('unknown');
    expect(buildStamp({ PASSBACK_SHA: 'x*/y' }).sha).toBe('unknown');
    expect(buildStamp({ PASSBACK_SHA: 'x*/y', GITHUB_SHA: 'bbb' }).sha).toBe('bbb');
  });
});
