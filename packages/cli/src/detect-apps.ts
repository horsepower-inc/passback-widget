import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { detectFramework, type DetectedFramework } from './detect-framework';

export type AppInfo = { dir: string; framework: DetectedFramework };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function yamlPackages(yaml: string): string[] {
  const lines = yaml.split('\n');
  const start = lines.findIndex((line) => line.trim() === 'packages:');
  if (start === -1) {
    return [];
  }
  const entries: string[] = [];
  for (const line of lines.slice(start + 1)) {
    const entry = line.match(/^\s+-\s+(\S+)/)?.[1];
    if (!entry) {
      break;
    }
    entries.push(entry.replace(/^['"]|['"]$/g, ''));
  }
  return entries;
}

function jsonPackages(packageJson: unknown): string[] {
  if (!isPlainObject(packageJson)) {
    return [];
  }
  const { workspaces } = packageJson;
  const list = isPlainObject(workspaces) ? workspaces.packages : workspaces;
  return Array.isArray(list) ? list.filter((p): p is string => typeof p === 'string') : [];
}

/** The workspace globs of a project: pnpm-workspace.yaml `packages:`, else package.json `workspaces`. */
export function workspacePatterns(
  pnpmWorkspaceYaml: string | undefined,
  packageJson: unknown,
): string[] {
  const fromYaml = pnpmWorkspaceYaml === undefined ? [] : yamlPackages(pnpmWorkspaceYaml);
  const patterns = fromYaml.length > 0 ? fromYaml : jsonPackages(packageJson);
  return patterns.filter((pattern) => !pattern.startsWith('!'));
}

async function readOptional(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw err;
  }
}

async function readApp(root: string, dir: string): Promise<AppInfo | undefined> {
  const text = await readOptional(path.join(root, dir, 'package.json'));
  if (text === undefined) {
    return undefined;
  }
  try {
    return { dir, framework: detectFramework(JSON.parse(text)) };
  } catch {
    return undefined;
  }
}

async function expandPattern(root: string, pattern: string): Promise<string[]> {
  const trimmed = pattern.replace(/\/+$/, '');
  if (!trimmed.includes('*')) {
    return [trimmed.replace(/^\.\//, '')];
  }
  // Only a pattern ending `/*` expands; `./*` is the children of the root, a bare `*` is skipped.
  if (!trimmed.endsWith('/*')) {
    return [];
  }
  const parent = trimmed.slice(0, -2);
  const base = parent === '.' ? '' : parent.replace(/^\.\//, '');
  if (base.includes('*')) {
    return [];
  }
  let children;
  try {
    children = await readdir(path.join(root, base), { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw err;
  }
  return children
    .filter((c) => c.isDirectory())
    .map((c) => (base === '' ? c.name : `${base}/${c.name}`));
}

async function projectPatterns(root: string): Promise<string[]> {
  const yaml = await readOptional(path.join(root, 'pnpm-workspace.yaml'));
  const packageText = await readOptional(path.join(root, 'package.json'));
  let packageJson: unknown;
  try {
    packageJson = packageText === undefined ? undefined : JSON.parse(packageText);
  } catch {
    packageJson = undefined;
  }
  return workspacePatterns(yaml, packageJson);
}

/** Finds the workspace apps under `root`, or takes exactly `options.only` when given. */
export async function scanApps(root: string, options: { only?: string[] } = {}): Promise<AppInfo[]> {
  if (options.only !== undefined) {
    const apps: AppInfo[] = [];
    for (const dir of options.only) {
      const app = await readApp(root, dir);
      if (app === undefined) {
        throw new Error(`--app ${dir}: no package.json in ${dir}`);
      }
      apps.push(app);
    }
    return apps;
  }

  const patterns = await projectPatterns(root);

  const dirs = new Set<string>();
  for (const pattern of patterns) {
    for (const dir of await expandPattern(root, pattern)) {
      dirs.add(dir);
    }
  }
  const apps: AppInfo[] = [];
  for (const dir of dirs) {
    const app = await readApp(root, dir);
    if (app !== undefined) {
      apps.push(app);
    }
  }
  return apps.sort((a, b) => (a.dir < b.dir ? -1 : a.dir > b.dir ? 1 : 0));
}
