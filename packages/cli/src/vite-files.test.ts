import { describe, expect, it } from 'vitest';
import { addVitePlugin, planViteApp } from './vite-files';

const IMPORT = "import passback from '@passback/vite-plugin';";
const DEFINE =
  "import { defineConfig } from 'vite';\nimport react from '@vitejs/plugin-react';\n\nexport default defineConfig({\n  plugins: [react()],\n});\n";

function edited(text: string, rootRelative = '.'): string {
  const edit = addVitePlugin(text, rootRelative);
  if (!edit.ok) {
    throw new Error(edit.reason);
  }
  return edit.text;
}

describe('addVitePlugin', () => {
  it('adds the import and passback() to a defineConfig plugins list', () => {
    const text = edited(DEFINE);
    expect(text).toContain('plugins: [passback(), react()],');
    expect(text).toContain(`import react from '@vitejs/plugin-react';\n${IMPORT}\n`);
  });

  it('adds passback() to the plugins list of a plain exported object', () => {
    const text = edited('export default {\n  plugins: [],\n};\n');
    expect(text).toContain('plugins: [passback()],');
    expect(text.startsWith(`${IMPORT}\n`)).toBe(true);
  });

  it('puts passback() on its own line in a list written over several lines', () => {
    const text = edited('export default {\n  plugins: [\n    react(),\n  ],\n};\n');
    expect(text).toContain('plugins: [\n    passback(),\n    react(),\n  ],');
  });

  it('passes the root to passback() for an app below the project root', () => {
    expect(edited(DEFINE, '../..')).toContain("plugins: [passback({ root: '../..' }), react()],");
  });

  it('leaves a config that already imports the plugin unchanged', () => {
    const text = `${IMPORT}\nexport default defineConfig(({ mode }) => ({ plugins: [passback()] }));\n`;
    expect(addVitePlugin(text, '.')).toEqual({ ok: true, changed: false, text });
  });

  it('adds passback() to a function-form defineConfig with an object body', () => {
    const text = edited(
      "import react from '@vitejs/plugin-react';\nexport default defineConfig(({ mode }) => ({ plugins: [react()] }));\n",
    );
    expect(text).toContain('plugins: [passback(), react()]');
    expect(text).toContain(IMPORT);
  });

  it('adds passback() to a function-form defineConfig with a block body', () => {
    const text = edited(
      "import react from '@vitejs/plugin-react';\nexport default defineConfig(async ({ command, mode }) => {\n  return { plugins: [react()] };\n});\n",
    );
    expect(text).toContain('plugins: [passback(), react()]');
    expect(text).toContain(IMPORT);
  });

  it('refuses a config without a plugins list or with two plugins lists', () => {
    const refused = { ok: false, reason: 'unrecognised vite.config shape' };
    expect(addVitePlugin('export default {};\n', '.')).toEqual(refused);
    expect(
      addVitePlugin('export default {\n  plugins: [a()],\n  test: { plugins: [b()] },\n};\n', '.'),
    ).toEqual(refused);
  });
});

describe('planViteApp', () => {
  it('plans the edited config and the install line for a recognised config', () => {
    const plan = planViteApp({
      dir: 'apps/site',
      rootRelative: '../..',
      config: { path: 'apps/site/vite.config.ts', text: DEFINE },
    });
    expect(plan.writes).toEqual([
      { path: 'apps/site/vite.config.ts', text: edited(DEFINE, '../..') },
    ]);
    expect(plan.printed).toEqual(['apps/site: install it: npm i -D @passback/vite-plugin']);
  });

  it('prints the manual line and the install line and writes nothing for an unrecognised or missing config', () => {
    const text = 'export default defineConfig(config);\n';
    const refused = planViteApp({
      dir: '.',
      rootRelative: '.',
      config: { path: 'vite.config.ts', text },
    });
    expect(refused.writes).toEqual([]);
    expect(refused.printed).toEqual([
      ".: vite.config.ts left as it is (unrecognised vite.config shape); add passback() to its plugins by hand: import passback from '@passback/vite-plugin'",
      '.: install it: npm i -D @passback/vite-plugin',
    ]);
    const missing = planViteApp({ dir: '.', rootRelative: '.' });
    expect(missing.writes).toEqual([]);
    expect(missing.printed[0]).toBe(
      ".: no vite.config found; add passback() to its plugins by hand: import passback from '@passback/vite-plugin'",
    );
  });
});
