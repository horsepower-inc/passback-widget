import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runInit } from './init-run';

const ALL = ['claude', 'codex', 'cursor'] as const;
const AGENTS = [...ALL];
const NEXT_URL = 'http://localhost:3000';

const tmpDirs: string[] = [];

afterEach(async () => {
  for (const dir of tmpDirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function put(root: string, rel: string, text: string): Promise<void> {
  await mkdir(path.dirname(path.join(root, rel)), { recursive: true });
  await writeFile(path.join(root, rel), text, 'utf8');
}

async function project(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'passback-init-mcp-url-'));
  tmpDirs.push(root);
  for (const [rel, text] of Object.entries(files)) await put(root, rel, text);
  return root;
}

const pkg = (deps: Record<string, string>): string => JSON.stringify({ dependencies: deps });
const NEXT_PKG = pkg({ next: '15.0.0', react: '19.0.0' });
const VITE_PKG = pkg({ vite: '5.0.0' });
const VITE_REACT_PKG = pkg({ vite: '5.0.0', react: '18.0.0' });

async function read(root: string, rel: string): Promise<string | undefined> {
  return readFile(path.join(root, rel), 'utf8').catch(() => undefined);
}

interface Urls {
  claude: string | undefined;
  cursor: string | undefined;
  codex: string | undefined;
}

/** The PASSBACK_URL each generated MCP file carries, from disk (undefined when absent). */
async function urlsOnDisk(root: string): Promise<Urls> {
  const json = async (rel: string): Promise<string | undefined> => {
    const text = await read(root, rel);
    if (text === undefined) return undefined;
    return JSON.parse(text).mcpServers.passback.env?.PASSBACK_URL;
  };
  const toml = (await read(root, '.codex/config.toml')) ?? '';
  return {
    claude: await json('.mcp.json'),
    cursor: await json('.cursor/mcp.json'),
    codex: /^\[mcp_servers\.passback\.env\]\nPASSBACK_URL = "([^"]*)"$/m.exec(toml)?.[1],
  };
}

const same = (url: string | undefined): Urls => ({ claude: url, cursor: url, codex: url });

async function initUrls(root: string, apps?: string[]): Promise<Urls> {
  await runInit(root, { agents: AGENTS, apply: true, apps });
  return urlsOnDisk(root);
}

const viteConfig = (body: string): string => `export default ${body};\n`;

describe('init writes PASSBACK_URL for the MCP server', () => {
  it('writes the Next URL into every newly generated MCP server', async () => {
    const root = await project({
      'package.json': NEXT_PKG,
      '.mcp.json': JSON.stringify({ mcpServers: { other: { command: 'x' } }, extra: 1 }),
      '.cursor/mcp.json': JSON.stringify({ mcpServers: { other: { command: 'y' } } }),
      '.codex/config.toml': '[mcp_servers.other]\ncommand = "z"\n',
    });

    await runInit(root, { agents: AGENTS, apply: true });

    expect(await urlsOnDisk(root)).toEqual(same(NEXT_URL));
    const claude = JSON.parse((await read(root, '.mcp.json'))!);
    expect(claude.extra).toBe(1);
    expect(claude.mcpServers.other).toEqual({ command: 'x' });
    expect(claude.mcpServers.passback).toEqual({
      command: 'npx',
      args: ['passback', 'dev'],
      env: { PASSBACK_URL: NEXT_URL },
    });
    const cursor = JSON.parse((await read(root, '.cursor/mcp.json'))!);
    expect(cursor.mcpServers.other).toEqual({ command: 'y' });
    const codex = (await read(root, '.codex/config.toml'))!;
    expect(codex.startsWith('[mcp_servers.other]\ncommand = "z"\n')).toBe(true);
    expect(codex).toContain(
      '[mcp_servers.passback]\ncommand = "npx"\nargs = ["passback", "dev"]\ntool_timeout_sec = 180\n\n' +
        `[mcp_servers.passback.env]\nPASSBACK_URL = "${NEXT_URL}"\n`,
    );

    const second = await runInit(root, { agents: AGENTS, apply: true });
    expect(second.written.filter((p) => /mcp|codex/.test(p))).toEqual([]);
    expect(second.planned).toEqual([]);
  });

  it('writes a literal Vite server port into every generated MCP server', async () => {
    const cases: [string, string, string][] = [
      [VITE_PKG, viteConfig('{ server: { port: 1 } }'), 'http://localhost:1'],
      [
        VITE_REACT_PKG,
        viteConfig('defineConfig({ plugins: [react()], server: { host: true, port: 65535 } })'),
        'http://localhost:65535',
      ],
      [
        VITE_REACT_PKG,
        "import { defineConfig } from 'vite';\nexport default defineConfig({\n  server: {\n    port: 4000,\n  },\n});\n",
        'http://localhost:4000',
      ],
      [VITE_PKG, viteConfig('{ plugins: [], server: { port: 8080, }, }'), 'http://localhost:8080'],
      [VITE_PKG, viteConfig('defineConfig({ server: { port: 4000 } },)'), 'http://localhost:4000'],
    ];
    for (const [packageJson, config, url] of cases) {
      const root = await project({ 'package.json': packageJson, 'vite.config.ts': config });
      expect(await initUrls(root)).toEqual(same(url));
      await rm(root, { recursive: true, force: true });
    }
  });

  it('leaves unsupported Vite ports and ambiguous apps on the existing fallback', async () => {
    const configs: (string | undefined)[] = [
      undefined,
      viteConfig('{ plugins: [] }'),
      '// server: { port: 4000 }\nexport default {};\n',
      '/* server: { port: 4000 } */\nexport default {};\n',
      viteConfig("{ note: 'server: { port: 4000 }' }"),
      viteConfig('{ server: { host: "port: 4000" } }'),
      viteConfig('{ preview: { port: 4000 } }'),
      viteConfig('{ server: { proxy: { target: { port: 4000 } } } }'),
      viteConfig('{ other: { server: { port: 4000 } } }'),
      viteConfig('{ server: { port: 3000 + 1 } }'),
      viteConfig('{ server: { port: PORT } }'),
      viteConfig('{ server: { port: process.env.PORT } }'),
      viteConfig('{ server: { port: "4000" } }'),
      viteConfig('{ server: { port: 4000.5 } }'),
      viteConfig('{ server: { port: 0x1000 } }'),
      viteConfig('{ server: { port: 1e3 } }'),
      viteConfig('{ server: { "port": 4000 } }'),
      viteConfig('{ "server": { port: 4000 } }'),
      viteConfig('{ [key]: 1, server: { port: 4000 } }'),
      'export default defineConfig(() => ({ server: { port: 4000 } }));\n',
      'export default () => ({ server: { port: 4000 } });\n',
      'export default defineConfig(({ mode }) => ({ server: { port: 4000 } }));\n',
      'const config = { server: { port: 4000 } };\nexport default config;\n',
      viteConfig('{ ...base, server: { port: 4000 } }'),
      viteConfig('{ server: { ...base, port: 4000 } }'),
      viteConfig('{ server: { port: 4000, port: 4001 } }'),
      viteConfig('{ server: { port: 4000 }, server: { port: 4001 } }'),
      viteConfig('{ server: base }'),
      viteConfig('{ server }'),
      viteConfig('{ server: { port } }'),
      viteConfig('{ server: { port: 0 } }'),
      viteConfig('{ server: { port: 65536 } }'),
      viteConfig('{ server: { port: 007 } }'),
      viteConfig('{ server: { port: -1 } }'),
      viteConfig('{ server: { port: 4000 } && { port: 5000 } }'),
      viteConfig('{ server: { port: 4000 } || base }'),
      viteConfig('{ server: { port: 4000 } } && { server: { port: 5000 } }'),
      viteConfig('{ server: { port: 4000 } } as UserConfig'),
      viteConfig('defineConfig({ server: { port: 4000 } }) || base'),
      viteConfig('defineConfig({ server: { port: 4000 } }, extra)'),
      viteConfig('defineConfig({ server: { port: 4000 } },,)'),
      viteConfig('defineConfig({ server: { port: 4000 } })(base)'),
    ];
    for (const config of configs) {
      const files: Record<string, string> = { 'package.json': VITE_PKG };
      if (config !== undefined) files['vite.config.ts'] = config;
      const root = await project(files);
      expect(await initUrls(root), config).toEqual(same(undefined));
      await rm(root, { recursive: true, force: true });
    }

    const unknown = await project({ 'package.json': pkg({ express: '4.0.0' }) });
    expect(await initUrls(unknown)).toEqual(same(undefined));
    await rm(unknown, { recursive: true, force: true });

    const workspace = await project({
      'package.json': JSON.stringify({ name: 'root' }),
      'pnpm-workspace.yaml': "packages:\n  - 'apps/*'\n",
      'apps/web/package.json': NEXT_PKG,
      'apps/site/package.json': VITE_PKG,
      'apps/site/vite.config.ts': viteConfig('{ server: { port: 4000 } }'),
    });
    expect(await initUrls(workspace)).toEqual(same(undefined));
    const none = await project({
      'package.json': JSON.stringify({ name: 'root' }),
      'pnpm-workspace.yaml': "packages:\n  - 'apps/*'\n",
    });
    expect(await initUrls(none)).toEqual(same(undefined));
  });

  it('uses the explicitly selected app for the generated MCP URL', async () => {
    const files = {
      'package.json': JSON.stringify({ name: 'root' }),
      'pnpm-workspace.yaml': "packages:\n  - 'apps/*'\n",
      'apps/web/package.json': NEXT_PKG,
      'apps/site/package.json': VITE_REACT_PKG,
      'apps/site/vite.config.ts': viteConfig('{ server: { port: 4123 } }'),
    };
    const nextRoot = await project(files);
    expect(await initUrls(nextRoot, ['apps/web'])).toEqual(same(NEXT_URL));
    await rm(nextRoot, { recursive: true, force: true });

    const viteRoot = await project(files);
    expect(await initUrls(viteRoot, ['apps/site'])).toEqual(same('http://localhost:4123'));
    await rm(viteRoot, { recursive: true, force: true });

    const both = await project(files);
    expect(await initUrls(both, ['apps/site', 'apps/web'])).toEqual(same(undefined));
  });

  it('preserves existing MCP entries and reports invalid JSON while configuring other agents', async () => {
    const custom = (url: string): string =>
      JSON.stringify({ mcpServers: { passback: { command: 'node', env: { PASSBACK_URL: url } } } });
    const claudeText = custom('http://localhost:9999');
    const cursorText = custom('http://localhost:8888');
    const codexText =
      '[mcp_servers.passback]\ncommand = "node"\n[mcp_servers.passback.env]\nPASSBACK_URL = "http://localhost:7777"\n';
    const root = await project({
      'package.json': NEXT_PKG,
      '.mcp.json': claudeText,
      '.cursor/mcp.json': cursorText,
      '.codex/config.toml': codexText,
    });

    await runInit(root, { agents: AGENTS, apply: true });

    expect(await read(root, '.mcp.json')).toBe(claudeText);
    expect(await read(root, '.cursor/mcp.json')).toBe(cursorText);
    expect(await read(root, '.codex/config.toml')).toBe(codexText);

    const badProject = await project({
      'package.json': NEXT_PKG,
      '.mcp.json': '{ nope',
    });
    const r1 = await runInit(badProject, { agents: AGENTS, apply: true });
    expect(await read(badProject, '.mcp.json')).toBe('{ nope');
    expect(r1.printed.join('\n')).toContain(
      '.mcp.json left as it is (invalid .mcp.json: not valid JSON)',
    );
    expect(
      JSON.parse((await read(badProject, '.cursor/mcp.json'))!).mcpServers.passback.env,
    ).toEqual({
      PASSBACK_URL: NEXT_URL,
    });
    expect(await read(badProject, '.codex/config.toml')).toContain(`PASSBACK_URL = "${NEXT_URL}"`);

    const badCursor = await project({
      'package.json': NEXT_PKG,
      '.cursor/mcp.json': '[]',
    });
    const r2 = await runInit(badCursor, { agents: AGENTS, apply: true });
    expect(await read(badCursor, '.cursor/mcp.json')).toBe('[]');
    expect(r2.printed.join('\n')).toContain('invalid .cursor/mcp.json: top level is not an object');
    expect(JSON.parse((await read(badCursor, '.mcp.json'))!).mcpServers.passback.env).toEqual({
      PASSBACK_URL: NEXT_URL,
    });
    expect(await read(badCursor, '.codex/config.toml')).toContain(`PASSBACK_URL = "${NEXT_URL}"`);
  });

  it('includes the inferred MCP URL in planned writes without applying them', async () => {
    const cases: [Record<string, string>, string][] = [
      [{ 'package.json': NEXT_PKG }, NEXT_URL],
      [
        { 'package.json': VITE_PKG, 'vite.config.ts': viteConfig('{ server: { port: 5555 } }') },
        'http://localhost:5555',
      ],
    ];
    for (const [files, url] of cases) {
      const root = await project(files);
      const result = await runInit(root, { agents: AGENTS });
      const planned = Object.fromEntries(result.planned.map((w) => [w.path, w.text]));
      expect(JSON.parse(planned['.mcp.json'] ?? '').mcpServers.passback.env).toEqual({
        PASSBACK_URL: url,
      });
      expect(JSON.parse(planned['.cursor/mcp.json'] ?? '').mcpServers.passback.env).toEqual({
        PASSBACK_URL: url,
      });
      expect(planned['.codex/config.toml']).toContain(
        `[mcp_servers.passback.env]\nPASSBACK_URL = "${url}"\n`,
      );
      for (const rel of ['.mcp.json', '.cursor/mcp.json', '.codex/config.toml']) {
        expect(await read(root, rel)).toBeUndefined();
      }
      await rm(root, { recursive: true, force: true });
    }
  });
});
