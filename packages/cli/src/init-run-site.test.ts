import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runInit } from './init-run';

let tmpDir: string;

async function makeProject(): Promise<string> {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'passback-init-run-site-'));
  return tmpDir;
}

afterEach(async () => {
  if (tmpDir) {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

async function writePackageJson(root: string, pkg: unknown): Promise<void> {
  await writeFile(path.join(root, 'package.json'), JSON.stringify(pkg), 'utf8');
}

const SITE = { siteKey: 'pb_test', endpoint: 'https://api.example' };

const VITE_CONFIG =
  "import { defineConfig } from 'vite';\n\nexport default defineConfig({\n  plugins: [],\n});\n";

const LAYOUT = `import "./globals.css";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
`;

async function makeViteProject(): Promise<string> {
  const root = await makeProject();
  await writePackageJson(root, { dependencies: { vite: '5.0.0', react: '18.0.0' } });
  await writeFile(path.join(root, 'vite.config.ts'), VITE_CONFIG, 'utf8');
  return root;
}

async function makeNextProject(): Promise<string> {
  const root = await makeProject();
  await writePackageJson(root, { dependencies: { next: '14.0.0', react: '18.0.0' } });
  await writeFile(path.join(root, 'next.config.js'), 'module.exports = {};\n', 'utf8');
  await mkdir(path.join(root, 'app'), { recursive: true });
  await writeFile(path.join(root, 'app/layout.tsx'), LAYOUT, 'utf8');
  return root;
}

describe('runInit with a site', () => {
  it('writes the site options into the vite config of a vite project', async () => {
    const root = await makeViteProject();

    const result = await runInit(root, { apply: true, agents: ['claude'], site: SITE });

    const text = await readFile(path.join(root, 'vite.config.ts'), 'utf8');
    expect(text).toContain(
      "passback({ mode: process.env.NODE_ENV === 'production' ? 'relay' : 'agent', stagingModes: ['staging'], siteKey: 'pb_test', endpoint: 'https://api.example' })",
    );
    expect(result.written).toContain('vite.config.ts');
  });

  it('writes the site options into the Passback tag of a next root layout', async () => {
    const root = await makeNextProject();

    const result = await runInit(root, { apply: true, agents: ['claude'], site: SITE });

    const text = await readFile(path.join(root, 'app/layout.tsx'), 'utf8');
    expect(text).toContain(
      `<Passback mode={process.env.NODE_ENV === 'production' ? 'relay' : 'agent'} siteKey="pb_test" endpoint="https://api.example" />`,
    );
    expect(result.written).toContain('app/layout.tsx');
  });

  it('writes nothing on a second run with the same site', async () => {
    const root = await makeViteProject();
    await runInit(root, { apply: true, agents: ['claude'], site: SITE });

    const second = await runInit(root, { apply: true, agents: ['claude'], site: SITE });

    expect(second.written).toEqual([]);
  });

  it('writes siteKey and endpoint into a plugin already on disk without apply', async () => {
    const root = await makeViteProject();
    await writeFile(
      path.join(root, 'vite.config.ts'),
      VITE_CONFIG.replace('plugins: []', 'plugins: [passback()]').replace(
        '\n\n',
        "\nimport passback from '@passback/vite-plugin';\n\n",
      ),
      'utf8',
    );

    const result = await runInit(root, { agents: ['claude'], site: SITE });

    const text = await readFile(path.join(root, 'vite.config.ts'), 'utf8');
    expect(text).toContain('pb_test');
    expect(result.written).toContain('vite.config.ts');
    expect(result.planned.map((w) => w.path)).not.toContain('vite.config.ts');
  });

  it('leaves the plugin options alone without a site', async () => {
    const root = await makeViteProject();

    await runInit(root, { apply: true, agents: ['claude'] });

    const text = await readFile(path.join(root, 'vite.config.ts'), 'utf8');
    expect(text).toContain('passback()');
    expect(text).not.toContain('siteKey');
    expect(text).not.toContain('mode:');
  });

  it('returns staging build guidance for site setup without changing ordinary or Next setup', async () => {
    const BUILD = 'vite build --mode staging';
    const applied = await runInit(await makeViteProject(), {
      apply: true,
      agents: ['claude'],
      site: SITE,
    });
    expect(applied.printed.filter((l) => l.includes(BUILD))).toHaveLength(1);
    const repeat = await runInit(tmpDir, { apply: true, agents: ['claude'], site: SITE });
    expect(repeat.written).toEqual([]);
    expect(repeat.printed.filter((l) => l.includes(BUILD))).toHaveLength(1);

    const planned = await runInit(await makeViteProject(), { agents: ['claude'], site: SITE });
    expect(planned.printed.filter((l) => l.includes(BUILD))).toHaveLength(1);
    expect(planned.planned.find((w) => w.path === 'vite.config.ts')?.text).toContain(
      "stagingModes: ['staging']",
    );

    const root = await makeViteProject();
    await writeFile(
      path.join(root, 'vite.config.ts'),
      VITE_CONFIG.replace('plugins: []', 'plugins: [passback()]').replace(
        '\n\n',
        "\nimport passback from '@passback/vite-plugin';\n\n",
      ),
      'utf8',
    );
    const existing = await runInit(root, { agents: ['claude'], site: SITE });
    expect(existing.printed.filter((l) => l.includes(BUILD))).toHaveLength(1);
    expect(await readFile(path.join(root, 'vite.config.ts'), 'utf8')).toContain(
      "stagingModes: ['staging']",
    );

    const ordinary = await runInit(await makeViteProject(), { apply: true, agents: ['claude'] });
    const next = await runInit(await makeNextProject(), {
      apply: true,
      agents: ['claude'],
      site: SITE,
    });
    for (const result of [ordinary, next]) {
      expect(result.printed.join('\n')).not.toContain(BUILD);
      expect(result.printed.join('\n')).not.toContain('stagingModes');
    }
    expect(await readFile(path.join(tmpDir, 'app/layout.tsx'), 'utf8')).not.toContain(
      'stagingModes',
    );
  });
});
