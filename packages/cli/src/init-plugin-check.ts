import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { AppInfo } from './detect-apps';
import type { DetectedFramework } from './detect-framework';

export interface PluginTarget {
  dir: string;
  framework: DetectedFramework;
  /** Package names declared in the target's own dependencies and devDependencies. */
  declared: Set<string>;
}

const VITE_PLUGIN = '@passback/vite-plugin';
const NEXT_PLUGIN = '@passback/next';

function declaredNames(pkg: unknown): Set<string> {
  const names = new Set<string>();
  if (typeof pkg !== 'object' || pkg === null || Array.isArray(pkg)) {
    return names;
  }
  for (const field of ['dependencies', 'devDependencies']) {
    const value = (pkg as Record<string, unknown>)[field];
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      for (const name of Object.keys(value)) names.add(name);
    }
  }
  return names;
}

/** Each targeted app with the packages its own package.json declares; the root when there are no apps. */
export async function readPluginTargets(
  root: string,
  apps: AppInfo[],
  rootFramework: DetectedFramework,
  rootPackageJson: unknown,
): Promise<PluginTarget[]> {
  if (apps.length === 0) {
    return [{ dir: '.', framework: rootFramework, declared: declaredNames(rootPackageJson) }];
  }
  const targets: PluginTarget[] = [];
  for (const app of apps) {
    const text = await readFile(path.join(root, app.dir, 'package.json'), 'utf8');
    targets.push({
      dir: app.dir,
      framework: app.framework,
      declared: declaredNames(JSON.parse(text)),
    });
  }
  return targets;
}

/** One repair line per target whose declared plugin is the wrong one for its framework. */
export function pluginMismatches(targets: PluginTarget[]): string[] {
  const lines: string[] = [];
  for (const { dir, framework, declared } of targets) {
    if (framework === 'next' && declared.has(VITE_PLUGIN)) {
      lines.push(
        `${dir}: ${VITE_PLUGIN} is installed for a Next app; run: npm uninstall ${VITE_PLUGIN} && npm i -D ${NEXT_PLUGIN}`,
      );
    } else if ((framework === 'vite' || framework === 'vite-react') && declared.has(NEXT_PLUGIN)) {
      lines.push(
        `${dir}: ${NEXT_PLUGIN} is installed for a Vite app; run: npm uninstall ${NEXT_PLUGIN} && npm i -D ${VITE_PLUGIN}`,
      );
    }
  }
  return lines;
}
