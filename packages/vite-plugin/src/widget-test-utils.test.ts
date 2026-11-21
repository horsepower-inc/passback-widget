import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { cleanupRoot, jsxProduction, tempRoot } from './widget-test-utils';

const root = tempRoot('passback-test-utils-');

afterAll(() => cleanupRoot(root));

describe('widget test utils', () => {
  it('tempRoot installs a react jsx runtime stub', () => {
    const dir = join(root, 'node_modules', 'react');
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    expect(Object.keys(pkg.exports)).toEqual(['./jsx-dev-runtime', './jsx-runtime']);
    const runtime = readFileSync(join(dir, 'jsx-dev-runtime.js'), 'utf8');
    for (const name of ['jsxDEV', 'jsx', 'jsxs', 'Fragment']) {
      expect(runtime).toContain(`export const ${name} =`);
    }
  });

  it('jsxProduction turns the dev jsx transform off', () => {
    expect(jsxProduction).toEqual({ oxc: { jsx: { development: false } } });
  });
});
