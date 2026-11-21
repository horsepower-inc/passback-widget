import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { build, type Plugin } from 'vite';
import { describe, expect, it } from 'vitest';
import { writeManifest } from './manifest';
import { passback } from './plugin';
import { tempRoot } from './widget-test-utils';

const BUILD_ID = 'abc1234';
const OTHER_BUILD_ID = 'def5678';
const GENERATE_BUNDLE_SENTINEL = 'pb-458 sentinel: generateBundle failure';

type SourceIdsApi = { sourceIds(): ReadonlyMap<string, string> };

function manifestPath(root: string): string {
  return join(root, '.passback', 'manifest.json');
}

function seedManifest(root: string): string {
  writeManifest(root, BUILD_ID, new Map([['old1', 'src/Old.tsx:1:1']]));
  writeManifest(root, OTHER_BUILD_ID, new Map([['old2', 'src/Other.tsx:2:2']]));
  return readFileSync(manifestPath(root), 'utf8');
}

function writeReachableModule(root: string): void {
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(
    join(root, 'index.html'),
    '<!doctype html><html><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>\n',
  );
  writeFileSync(join(root, 'src', 'main.tsx'), 'console.log(<div>Hi</div>);\n');
}

function throwingGenerateBundlePlugin(): Plugin {
  return {
    name: 'pb-458-test-generate-bundle-failure',
    generateBundle() {
      throw new Error(GENERATE_BUNDLE_SENTINEL);
    },
  };
}

function collectedMappings(plugin: Plugin): ReadonlyMap<string, string> {
  return (plugin.api as unknown as SourceIdsApi).sourceIds();
}

describe('passback output-stage manifest publication', () => {
  it('preserves the same build manifest when generateBundle fails', async () => {
    const root = tempRoot('passback-output-');
    try {
      writeReachableModule(root);
      const before = seedManifest(root);
      const plugin = passback({ buildId: BUILD_ID, stagingModes: ['staging'] });

      await expect(
        build({
          root,
          configFile: false,
          mode: 'staging',
          plugins: [plugin, throwingGenerateBundlePlugin()],
          logLevel: 'silent',
          build: { minify: false },
        }),
      ).rejects.toThrow(GENERATE_BUNDLE_SENTINEL);

      expect(collectedMappings(plugin).size).toBeGreaterThan(0);
      expect(readFileSync(manifestPath(root), 'utf8')).toBe(before);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 20000);

  it('preserves the same build manifest when output writing fails', async () => {
    const root = tempRoot('passback-output-');
    try {
      writeReachableModule(root);
      const before = seedManifest(root);
      const blockedOutDir = join(root, 'dist-blocked');
      writeFileSync(blockedOutDir, 'not a directory');
      const plugin = passback({ buildId: BUILD_ID, stagingModes: ['staging'] });

      await expect(
        build({
          root,
          configFile: false,
          mode: 'staging',
          plugins: [plugin],
          logLevel: 'silent',
          build: { minify: false, outDir: blockedOutDir },
        }),
      ).rejects.toThrow();

      expect(collectedMappings(plugin).size).toBeGreaterThan(0);
      expect(readFileSync(manifestPath(root), 'utf8')).toBe(before);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 20000);

  it('preserves the manifest when output writing is disabled', async () => {
    const root = tempRoot('passback-output-');
    try {
      writeReachableModule(root);
      const before = seedManifest(root);
      const plugin = passback({ buildId: BUILD_ID, stagingModes: ['staging'] });

      await build({
        root,
        configFile: false,
        mode: 'staging',
        plugins: [plugin],
        logLevel: 'silent',
        build: { minify: false, write: false },
      });

      expect(collectedMappings(plugin).size).toBeGreaterThan(0);
      expect(readFileSync(manifestPath(root), 'utf8')).toBe(before);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 20000);

  it('replaces the same build mappings after successful output', async () => {
    const root = tempRoot('passback-output-');
    try {
      writeReachableModule(root);
      seedManifest(root);
      const plugin = passback({ buildId: BUILD_ID, stagingModes: ['staging'] });

      await build({
        root,
        configFile: false,
        mode: 'staging',
        plugins: [plugin],
        logLevel: 'silent',
        build: { minify: false },
      });

      expect(collectedMappings(plugin).size).toBeGreaterThan(0);
      const manifest = JSON.parse(readFileSync(manifestPath(root), 'utf8'));
      expect(manifest[BUILD_ID]).not.toHaveProperty('old1');
      expect(Object.keys(manifest[BUILD_ID]).length).toBeGreaterThan(0);
      expect(manifest[OTHER_BUILD_ID]).toEqual({ old2: 'src/Other.tsx:2:2' });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 20000);
});
