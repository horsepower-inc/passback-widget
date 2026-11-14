import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { explainAgents, selectAgents, type AgentId, type AgentMarker } from './agent-select';
import { CLAUDE_COMMAND_PATH } from './claude-command';
import { CODEX_CONFIG_PATH, CODEX_SKILL_PATH } from './codex-files';
import { CURSOR_MCP_PATH, CURSOR_SKILL_PATH } from './cursor-files';
import { scanApps, type AppInfo } from './detect-apps';
import { detectFramework, type DetectedFramework } from './detect-framework';
import { splitInitWrites } from './init-apply';
import { inferMcpUrl, withMcpUrl } from './init-mcp-url';
import { pluginMismatches, readPluginTargets } from './init-plugin-check';
import { planInit, type InitInput } from './init-plan';
import { nextRoutePath, type NextAppInput } from './next-files';
import { nextSteps } from './next-steps';
import { planSiteOptions, type SiteOptions, type SourceFile } from './site-options';
import { readViteApps } from './vite-app-inputs';
import { planViteApp, type ViteAppInput, type ViteWrite } from './vite-files';

export interface InitResult {
  framework: DetectedFramework;
  agents: AgentId[];
  apps: AppInfo[];
  written: string[];
  planned: { path: string; text: string }[];
  printed: string[];
  nextSteps: string[];
}

async function readOptionalText(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw err;
  }
}

async function isDirectory(dirPath: string): Promise<boolean> {
  try {
    return (await stat(dirPath)).isDirectory();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw err;
  }
}

async function readOptionalInputs(
  root: string,
): Promise<Omit<InitInput, 'packageJson' | 'agents'>> {
  const [
    mcpJson,
    agentsMd,
    claudeCommand,
    codexConfig,
    codexSkill,
    cursorMcp,
    cursorSkill,
    gitignore,
  ] = await Promise.all(
    [
      '.mcp.json',
      'AGENTS.md',
      CLAUDE_COMMAND_PATH,
      CODEX_CONFIG_PATH,
      CODEX_SKILL_PATH,
      CURSOR_MCP_PATH,
      CURSOR_SKILL_PATH,
      '.gitignore',
    ].map((p) => readOptionalText(path.join(root, p))),
  );
  return {
    mcpJson,
    agentsMd,
    claudeCommand,
    codexConfig,
    codexSkill,
    cursorMcp,
    cursorSkill,
    gitignore,
  };
}

/** The agent markers present at the root: directories by stat, files by the contents already read. */
async function rootMarkers(
  root: string,
  optional: Pick<InitInput, 'mcpJson' | 'agentsMd'>,
): Promise<AgentMarker[]> {
  const markers: AgentMarker[] = [];
  for (const dir of ['.claude/', '.codex/', '.agents/', '.cursor/'] as const) {
    if (await isDirectory(path.join(root, dir))) markers.push(dir);
  }
  if (optional.mcpJson !== undefined) markers.push('.mcp.json');
  if (optional.agentsMd !== undefined) markers.push('AGENTS.md');
  return markers;
}

const NEXT_CONFIG_NAMES = [
  'next.config.ts',
  'next.config.mjs',
  'next.config.js',
  'next.config.cjs',
  'next.config.mts',
];

async function readFirstFile(
  root: string,
  dir: string,
  names: string[],
): Promise<{ path: string; text: string } | undefined> {
  for (const name of names) {
    const relPath = dir === '.' ? name : `${dir}/${name}`;
    const text = await readOptionalText(path.join(root, relPath));
    if (text !== undefined) {
      return { path: relPath, text };
    }
  }
  return undefined;
}

function rootRelativeOf(dir: string): string {
  return dir === '.'
    ? '.'
    : dir
        .split('/')
        .map(() => '..')
        .join('/');
}

const LAYOUT_NAMES = ['layout.tsx', 'layout.jsx', 'layout.js'];

async function readNextApp(root: string, dir: string): Promise<NextAppInput> {
  const appDir = path.join(root, dir);
  const srcApp =
    (await isDirectory(path.join(appDir, 'src/app'))) &&
    !(await isDirectory(path.join(appDir, 'app')));
  const routeExists =
    (await readOptionalText(path.join(root, nextRoutePath(dir, srcApp)))) !== undefined;
  const rootRelative = rootRelativeOf(dir);
  const config = await readFirstFile(root, dir, NEXT_CONFIG_NAMES);
  const layout = await readFirstFile(
    root,
    dir,
    LAYOUT_NAMES.map((n) => `${srcApp ? 'src/' : ''}app/${n}`),
  );
  return { dir, rootRelative, srcApp, routeExists, config, layout };
}

async function readNextApps(
  root: string,
  apps: AppInfo[],
  framework: DetectedFramework,
): Promise<NextAppInput[]> {
  const dirs =
    apps.length === 0
      ? framework === 'next'
        ? ['.']
        : []
      : apps.filter((a) => a.framework === 'next').map((a) => a.dir);
  const nextApps: NextAppInput[] = [];
  for (const dir of dirs) {
    nextApps.push(await readNextApp(root, dir));
  }
  return nextApps;
}

/** The plan's writes and printed lines with each Vite app's appended, in app order. */
async function withViteApps(
  root: string,
  apps: AppInfo[],
  framework: DetectedFramework,
  plan: { writes: ViteWrite[]; printed: string[] },
): Promise<{ writes: ViteWrite[]; printed: string[]; viteApps: ViteAppInput[] }> {
  const writes = [...plan.writes];
  const printed = [...plan.printed];
  const viteApps = await readViteApps(root, apps, framework, {
    readOptionalText,
    readPackageJson,
    rootRelativeOf,
  });
  for (const viteApp of viteApps) {
    const vitePlan = planViteApp(viteApp);
    writes.push(...vitePlan.writes);
    printed.push(...vitePlan.printed);
  }
  return { writes, printed, viteApps };
}

/** The joined writes and printed lines with the site options set in each Vite config and Next layout. */
function withSiteOptions(
  joined: { writes: SourceFile[]; printed: string[] },
  apps: { viteApps: ViteAppInput[]; nextApps: NextAppInput[] },
  site: SiteOptions | undefined,
): { writes: SourceFile[]; printed: string[] } {
  if (site === undefined) {
    return joined;
  }
  const sources = [
    ...apps.viteApps.flatMap((a) => (a.config ? [a.config] : [])),
    ...apps.nextApps.flatMap((a) => (a.layout ? [a.layout] : [])),
  ];
  const extra = planSiteOptions(sources, joined.writes, site);
  return { writes: extra.writes, printed: [...joined.printed, ...extra.printed] };
}

/** The Vite config and Next layout paths whose text already wires the plugin. */
function pluginPaths(viteApps: ViteAppInput[], nextApps: NextAppInput[]): Set<string> {
  const sources = [
    ...viteApps.flatMap((a) => (a.config ? [a.config] : [])),
    ...nextApps.flatMap((a) => (a.layout ? [a.layout] : [])),
  ];
  return new Set(
    sources
      .filter((s) => s.text.includes('passback(') || s.text.includes('<Passback'))
      .map((s) => s.path),
  );
}

async function readPackageJson(root: string): Promise<unknown> {
  const text = await readFile(path.join(root, 'package.json'), 'utf8').catch((err: unknown) => {
    throw (err as NodeJS.ErrnoException).code === 'ENOENT'
      ? new Error(`no package.json in ${root}`)
      : err;
  });
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`package.json in ${root} is not valid JSON`);
  }
}

/** Creates the directories, then writes each file with its parent directory. */
async function writeAll(root: string, dirs: string[], writes: SourceFile[]): Promise<void> {
  for (const dir of dirs) {
    await mkdir(path.join(root, dir), { recursive: true });
  }
  for (const write of writes) {
    await mkdir(path.dirname(path.join(root, write.path)), { recursive: true });
    await writeFile(path.join(root, write.path), write.text, 'utf8');
  }
}

/** Reads a project's package.json, .mcp.json and AGENTS.md, then creates the plan's directories and writes. */
export async function runInit(
  root: string,
  options: { agents?: AgentId[]; apps?: string[]; site?: SiteOptions; apply?: boolean } = {},
): Promise<InitResult> {
  const packageJson = await readPackageJson(root);
  const apps = await scanApps(root, { only: options.apps });

  const optional = await readOptionalInputs(root);

  const markers = await rootMarkers(root, optional);
  const agents = selectAgents({ flag: options.agents, markers });

  const rootFramework = detectFramework(packageJson);
  const mismatches = pluginMismatches(
    await readPluginTargets(root, apps, rootFramework, packageJson),
  );
  if (options.apply === true && mismatches.length > 0) {
    throw new Error(mismatches.join('\n'));
  }
  const nextApps = await readNextApps(root, apps, rootFramework);
  const plan = planInit({ packageJson, agents, nextApps, ...optional });
  const joined = await withViteApps(root, apps, rootFramework, plan);
  const { writes, printed } = withSiteOptions(
    joined,
    { viteApps: joined.viteApps, nextApps },
    options.site,
  );

  const url = inferMcpUrl({ appCount: apps.length, nextApps, viteApps: joined.viteApps });
  const { write: toWrite, planned } = splitInitWrites(withMcpUrl(writes, url), {
    apply: options.apply === true,
    pluginOnDisk: pluginPaths(joined.viteApps, nextApps),
  });
  await writeAll(root, plan.dirs, toWrite);

  return {
    framework: plan.framework,
    agents,
    apps,
    written: toWrite.map((w) => w.path),
    planned,
    printed: [...explainAgents({ flag: options.agents, markers }), ...printed, ...mismatches],
    nextSteps: nextSteps(agents, planned.length > 0),
  };
}
