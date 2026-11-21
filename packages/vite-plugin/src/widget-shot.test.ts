import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'vite';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import ensureWidgetBuilt from './global-setup';
import { passback } from './plugin';
import { cleanupRoot, tempRoot, writeProject } from './widget-test-utils';

type Options = Parameters<typeof passback>[0];

const RELAY = { mode: 'relay', siteKey: 'pb_abc', endpoint: 'https://api.example.com' } as const;
const SHOT_FILE = /^shot-[\w-]+\.js$/;

const roots: string[] = [];

beforeAll(() => ensureWidgetBuilt(), 120_000);

afterEach(() => {
  for (const root of roots.splice(0)) cleanupRoot(root);
});

async function buildSite(
  options: Options,
): Promise<{ shotAttr: string | undefined; files: string[] }> {
  const root = tempRoot();
  roots.push(root);
  writeProject(root);
  await build({
    root,
    mode: 'production',
    plugins: [passback({ buildId: 'abc1234', stagingModes: ['production'], ...options })],
    logLevel: 'silent',
    build: { minify: false },
  });
  const html = readFileSync(join(root, 'dist', 'index.html'), 'utf8');
  const shotAttr = /data-passback-shot="([^"]*)"/.exec(html)?.[1];
  return { shotAttr, files: readdirSync(join(root, 'dist', 'assets')) };
}

describe('built shot chunk', () => {
  it('emits shot-<hash>.js and points data-passback-shot at it for a relay build with screenshots on', async () => {
    const { shotAttr, files } = await buildSite({ ...RELAY, screenshots: true });
    expect(files.filter((file) => SHOT_FILE.test(file))).toHaveLength(1);
    expect(shotAttr).toMatch(/^\/assets\/shot-[\w-]+\.js$/);
  });

  it('emits no shot file and no data-passback-shot when screenshots are off', async () => {
    const { shotAttr, files } = await buildSite({ ...RELAY, screenshots: false });
    expect(files.filter((file) => file.startsWith('shot'))).toEqual([]);
    expect(shotAttr).toBeUndefined();
  });

  it('names the same shot file in the tag and in dist', async () => {
    const { shotAttr, files } = await buildSite(RELAY);
    expect(files).toContain(shotAttr?.split('/').pop());
  });
});
