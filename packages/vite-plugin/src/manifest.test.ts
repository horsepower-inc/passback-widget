import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ResolvedConfig } from 'vite';
import { describe, expect, it, vi } from 'vitest';
import { mergeManifest, writeManifest } from './manifest';
import { passback } from './plugin';

type ConfigResolvedFn = (config: ResolvedConfig) => void;
type WarnFn = (message: string) => void;
type BuildStartFn = (this: { warn: WarnFn }) => void;
type WriteBundleFn = (this: { warn: WarnFn }) => void;
type CloseBundleFn = (this: { warn: WarnFn }, error?: Error) => void;
type TransformFn = (this: { warn: WarnFn }, code: string, id: string) => unknown;

function tempRoot(): string {
  return realpathSync(mkdtempSync(join(tmpdir(), 'passback-')));
}

describe('mergeManifest', () => {
  it('adds the build ids under their build id', () => {
    const merged = mergeManifest({}, 'abc1234', new Map([['h1', 'src/App.tsx:1:1']]));
    expect(merged).toEqual({ abc1234: { h1: 'src/App.tsx:1:1' } });
  });

  it('keeps the entries of other build ids', () => {
    const existing = { def5678: { h0: 'src/Old.tsx:1:1' } };
    const merged = mergeManifest(existing, 'abc1234', new Map([['h1', 'src/App.tsx:1:1']]));
    expect(merged).toEqual({
      def5678: { h0: 'src/Old.tsx:1:1' },
      abc1234: { h1: 'src/App.tsx:1:1' },
    });
  });

  it('replaces the entries of the same build id', () => {
    const existing = { abc1234: { h0: 'src/Old.tsx:1:1' } };
    const merged = mergeManifest(existing, 'abc1234', new Map([['h1', 'src/App.tsx:1:1']]));
    expect(merged).toEqual({ abc1234: { h1: 'src/App.tsx:1:1' } });
  });

  it('starts fresh when the existing file is not a JSON object', () => {
    const root = tempRoot();
    mkdirSync(join(root, '.passback'));
    writeFileSync(join(root, '.passback', 'manifest.json'), 'not valid json {');

    writeManifest(root, 'abc1234', new Map([['h1', 'src/App.tsx:1:1']]));

    const manifest = JSON.parse(readFileSync(join(root, '.passback', 'manifest.json'), 'utf8'));
    expect(manifest).toEqual({ abc1234: { h1: 'src/App.tsx:1:1' } });
  });
});

describe('passback closeBundle', () => {
  it('writes .passback/manifest.json under the Vite root after a build', () => {
    const root = tempRoot();
    mkdirSync(join(root, 'src'));
    writeFileSync(
      join(root, 'src', 'App.tsx'),
      'export function App() {\n  return <div>Hi</div>;\n}\n',
    );

    const plugin = passback({ buildId: 'abc1234' });
    const configResolved = plugin.configResolved as unknown as ConfigResolvedFn;
    configResolved({ root, command: 'build' } as ResolvedConfig);

    const warn = vi.fn<WarnFn>();
    const transform = plugin.transform as unknown as TransformFn;
    transform.call(
      { warn },
      'export function App() {\n  return <div>Hi</div>;\n}\n',
      join(root, 'src', 'App.tsx'),
    );

    const writeBundle = plugin.writeBundle as unknown as WriteBundleFn;
    writeBundle.call({ warn });

    const closeBundle = plugin.closeBundle as unknown as CloseBundleFn;
    closeBundle.call({ warn });

    const manifest = JSON.parse(readFileSync(join(root, '.passback', 'manifest.json'), 'utf8'));
    expect(Object.keys(manifest.abc1234)).toHaveLength(1);
  });

  it('warns and writes nothing when no build id can be found', () => {
    const root = tempRoot();
    mkdirSync(join(root, 'src'));

    const plugin = passback();
    const configResolved = plugin.configResolved as unknown as ConfigResolvedFn;
    configResolved({ root, command: 'build' } as ResolvedConfig);

    const warn = vi.fn<WarnFn>();
    const transform = plugin.transform as unknown as TransformFn;
    transform.call(
      { warn },
      'export function App() {\n  return <div>Hi</div>;\n}\n',
      join(root, 'src', 'App.tsx'),
    );

    const writeBundle = plugin.writeBundle as unknown as WriteBundleFn;
    writeBundle.call({ warn });

    const closeBundle = plugin.closeBundle as unknown as CloseBundleFn;
    closeBundle.call({ warn });

    expect(warn).toHaveBeenCalledWith(
      'passback: no build id (not a git repo); pass passback({ buildId }) to write .passback/manifest.json',
    );
    expect(existsSync(join(root, '.passback', 'manifest.json'))).toBe(false);
  });

  it('leaves the previous manifest untouched when the build fails', () => {
    const root = tempRoot();
    mkdirSync(join(root, 'src'));
    writeFileSync(
      join(root, 'src', 'App.tsx'),
      'export function App() {\n  return <div>Hi</div>;\n}\n',
    );
    writeManifest(root, 'def5678', new Map([['h0', 'src/Old.tsx:1:1']]));

    const plugin = passback({ buildId: 'abc1234' });
    const configResolved = plugin.configResolved as unknown as ConfigResolvedFn;
    configResolved({ root, command: 'build' } as ResolvedConfig);

    const warn = vi.fn<WarnFn>();
    const transform = plugin.transform as unknown as TransformFn;
    transform.call(
      { warn },
      'export function App() {\n  return <div>Hi</div>;\n}\n',
      join(root, 'src', 'App.tsx'),
    );

    const closeBundle = plugin.closeBundle as unknown as CloseBundleFn;
    closeBundle.call({ warn }, new Error('build failed'));

    const manifest = JSON.parse(readFileSync(join(root, '.passback', 'manifest.json'), 'utf8'));
    expect(manifest).toEqual({ def5678: { h0: 'src/Old.tsx:1:1' } });
  });

  it('writes nothing when Vite serves', () => {
    const root = tempRoot();
    const plugin = passback();
    const configResolved = plugin.configResolved as unknown as ConfigResolvedFn;
    configResolved({ root, command: 'serve' } as ResolvedConfig);

    const warn = vi.fn<WarnFn>();
    const closeBundle = plugin.closeBundle as unknown as CloseBundleFn;
    closeBundle.call({ warn });

    expect(existsSync(join(root, '.passback', 'manifest.json'))).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  it('resets output success before the next build', () => {
    const root = tempRoot();
    mkdirSync(join(root, 'src'));
    writeFileSync(
      join(root, 'src', 'App.tsx'),
      'export function App() {\n  return <div>Hi</div>;\n}\n',
    );

    const plugin = passback({ buildId: 'abc1234' });
    const configResolved = plugin.configResolved as unknown as ConfigResolvedFn;
    configResolved({ root, command: 'build' } as ResolvedConfig);

    const warn = vi.fn<WarnFn>();
    const buildStart = plugin.buildStart as unknown as BuildStartFn;
    const transform = plugin.transform as unknown as TransformFn;
    const writeBundle = plugin.writeBundle as unknown as WriteBundleFn;
    const closeBundle = plugin.closeBundle as unknown as CloseBundleFn;

    buildStart.call({ warn });
    transform.call(
      { warn },
      'export function App() {\n  return <div>Hi</div>;\n}\n',
      join(root, 'src', 'App.tsx'),
    );
    writeBundle.call({ warn });
    closeBundle.call({ warn });

    const manifestPath = join(root, '.passback', 'manifest.json');
    const written = readFileSync(manifestPath, 'utf8');
    expect(JSON.parse(written).abc1234).toBeDefined();

    buildStart.call({ warn });
    closeBundle.call({ warn });

    expect(readFileSync(manifestPath, 'utf8')).toBe(written);
  });
});
