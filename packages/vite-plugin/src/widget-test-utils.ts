// Shared setup for the widget serve/build/leak integration tests: real temporary Vite project
// roots, the real widget artifact, and small helpers for reading real build/serve output.

import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { readWidgetArtifact } from './widget-bundle';

/** A temp project root with a stub `react` (no real React code) so a `.tsx` module's automatic
 * jsx runtime import resolves on Vite 8 (oxc/Rolldown), which resolves it at build time. */
export function tempRoot(prefix = 'passback-widget-'): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  const react = join(root, 'node_modules', 'react');
  mkdirSync(react, { recursive: true });
  writeFileSync(
    join(react, 'package.json'),
    JSON.stringify({
      name: 'react',
      version: '0.0.0-stub',
      exports: {
        './jsx-dev-runtime': './jsx-dev-runtime.js',
        './jsx-runtime': './jsx-dev-runtime.js',
      },
    }),
  );
  writeFileSync(
    join(react, 'jsx-dev-runtime.js'),
    'export const jsxDEV = () => null;\nexport const jsx = () => null;\nexport const jsxs = () => null;\nexport const Fragment = null;\n',
  );
  return root;
}

/** Turns the dev jsx transform off in a build, as `@vitejs/plugin-react` does in a real app.
 * Vite 8 reads `oxc`; Vite 7 ignores the unknown key. */
export const jsxProduction = { oxc: { jsx: { development: false } } } as unknown as Record<
  string,
  never
>;

export function cleanupRoot(root: string): void {
  rmSync(root, { recursive: true, force: true });
}

/** Writes an HTML entry whose module script points at `scriptSrc`, creating parent directories
 * for nested entries (e.g. "nested/page.html"). */
export function writeHtmlEntry(root: string, relPath: string, scriptSrc: string): void {
  const file = join(root, relPath);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(
    file,
    `<!doctype html><html><head></head><body><div id="root"></div><script type="module" src="${scriptSrc}"></script></body></html>\n`,
  );
}

export function writeMainModule(root: string, relPath = 'src/main.tsx'): void {
  const file = join(root, relPath);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, 'console.log(<div>Hi</div>);\n');
}

/** A minimal project: one HTML entry at `htmlPath` (default "index.html") loading a real tsx
 * module, ready for `createServer` or `build`. */
export function writeProject(root: string, htmlPath = 'index.html'): void {
  writeHtmlEntry(root, htmlPath, '/src/main.tsx');
  writeMainModule(root);
}

/** The real, prebuilt `@passback/widget` bytes — the same artifact the plugin resolves — for
 * asserting served/emitted output is the genuine bundle rather than an empty or mocked one. */
export function realWidgetBytes(variant: 'relay' | 'local' = 'relay'): Buffer {
  return readWidgetArtifact(variant).bytes;
}

export function listOutputFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath ?? entry.path, entry.name));
}

/** Concatenates every emitted file (including source maps) as text, for leak scans that must
 * catch an unmarked added artifact anywhere in the output. */
export function readAllOutputText(dir: string): string {
  return listOutputFiles(dir)
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n');
}

export function findOutputFile(dir: string, pattern: RegExp): string {
  const match = listOutputFiles(dir).find((file) => pattern.test(file));
  if (!match) throw new Error(`no output file matches ${pattern}`);
  return match;
}

/** The `src` of every `<script ... src="...">` tag, in document order. */
export function scriptSrcs(html: string): string[] {
  return [...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map((match) => match[1]!);
}
