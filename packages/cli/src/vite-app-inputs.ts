import path from 'node:path';
import type { AppInfo } from './detect-apps';
import type { DetectedFramework } from './detect-framework';
import { VITE_CONFIG_NAMES, type ViteAppInput } from './vite-files';

export interface ViteReaders {
  readOptionalText: (filePath: string) => Promise<string | undefined>;
  readPackageJson: (dir: string) => Promise<unknown>;
  rootRelativeOf: (dir: string) => string;
}

async function readViteConfig(
  root: string,
  dir: string,
  readOptionalText: ViteReaders['readOptionalText'],
): Promise<ViteAppInput['config']> {
  for (const name of VITE_CONFIG_NAMES) {
    const relPath = dir === '.' ? name : `${dir}/${name}`;
    const text = await readOptionalText(path.join(root, relPath));
    if (text !== undefined) {
      return { path: relPath, text };
    }
  }
  return undefined;
}

function isVite(framework: DetectedFramework): boolean {
  return framework === 'vite' || framework === 'vite-react';
}

/** Each selected Vite app with its config and its own parsed package.json, in app order. */
export async function readViteApps(
  root: string,
  apps: AppInfo[],
  framework: DetectedFramework,
  readers: ViteReaders,
): Promise<ViteAppInput[]> {
  const dirs =
    apps.length === 0
      ? isVite(framework)
        ? ['.']
        : []
      : apps.filter((a) => isVite(a.framework)).map((a) => a.dir);
  const viteApps: ViteAppInput[] = [];
  for (const dir of dirs) {
    viteApps.push({
      dir,
      rootRelative: readers.rootRelativeOf(dir),
      config: await readViteConfig(root, dir, readers.readOptionalText),
      packageJson: await readers.readPackageJson(path.join(root, dir)),
    });
  }
  return viteApps;
}
