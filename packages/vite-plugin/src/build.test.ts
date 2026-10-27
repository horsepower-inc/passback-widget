import type { ResolvedConfig } from 'vite';
import { describe, expect, it, vi } from 'vitest';
import type { injectSource } from './inject';
import { hashLocation } from './hash';
import { passback } from './plugin';

type TransformResult = ReturnType<typeof injectSource>;
type WarnFn = (message: string) => void;
type TransformFn = (code: string, id: string) => TransformResult;
type ConfigResolvedFn = (config: ResolvedConfig) => void;
type SourceIdsApi = { sourceIds(): ReadonlyMap<string, string> };

function pluginFor(root: string, command: 'build' | 'serve') {
  const plugin = passback();
  const configResolved = plugin.configResolved as unknown as ConfigResolvedFn;
  configResolved({ root, command } as ResolvedConfig);
  const warn = vi.fn<WarnFn>();
  const rawTransform = plugin.transform as unknown as (
    this: { warn: WarnFn },
    code: string,
    id: string,
  ) => TransformResult;
  const transform: TransformFn = (code, id) => rawTransform.call({ warn }, code, id);
  return {
    transform,
    warn,
    sourceIds: () => (plugin.api as unknown as SourceIdsApi).sourceIds(),
  };
}

describe('hashLocation', () => {
  it('hashLocation returns 8 lowercase hex characters', () => {
    const id = hashLocation('src/App.tsx:1:1');
    expect(id).toMatch(/^[0-9a-f]{8}$/);
  });

  it('hashLocation is stable for the same location', () => {
    expect(hashLocation('src/App.tsx:1:1')).toBe(hashLocation('src/App.tsx:1:1'));
  });
});

describe('passback build', () => {
  it('writes a hash id instead of a path when Vite builds', () => {
    const { transform } = pluginFor('/repo', 'build');
    const result = transform('<div />;', '/repo/src/App.tsx');
    expect(result?.code).toMatch(/data-source=\{"[0-9a-f]{8}"\}/);
    expect(result?.code).not.toContain('src/App.tsx');
  });

  it('records every hash id with its location on the plugin api', () => {
    const { transform, sourceIds } = pluginFor('/repo', 'build');
    transform('<div />;\n<span />;', '/repo/src/App.tsx');
    const ids = sourceIds();
    expect(ids.size).toBe(2);
    expect(ids.get(hashLocation('src/App.tsx:1:1'))).toBe('src/App.tsx:1:1');
    expect(ids.get(hashLocation('src/App.tsx:2:1'))).toBe('src/App.tsx:2:1');
  });

  it('keeps writing paths when Vite serves', () => {
    const { transform, sourceIds } = pluginFor('/repo', 'serve');
    const result = transform('<div />;', '/repo/src/App.tsx');
    expect(result?.code).toContain('data-source={"src/App.tsx:1:1"}');
    expect(sourceIds().size).toBe(0);
  });

  it('warns and keeps the first location on a hash id collision', async () => {
    vi.resetModules();
    vi.doMock('./hash', () => ({ hashLocation: () => 'aaaaaaaa' }));
    try {
      const { passback: mockedPassback } = await import('./plugin');
      const plugin = mockedPassback();
      const configResolved = plugin.configResolved as unknown as ConfigResolvedFn;
      configResolved({ root: '/repo', command: 'build' } as ResolvedConfig);
      const warn = vi.fn<WarnFn>();
      const rawTransform = plugin.transform as unknown as (
        this: { warn: WarnFn },
        code: string,
        id: string,
      ) => TransformResult;

      const result = rawTransform.call({ warn }, '<div />;\n<span />;', '/repo/src/App.tsx');

      expect(warn).toHaveBeenCalledWith('passback: source id collision aaaaaaaa');
      const ids = (plugin.api as unknown as SourceIdsApi).sourceIds();
      expect(ids.get('aaaaaaaa')).toBe('src/App.tsx:1:1');
      expect(result?.code).toContain('data-source={"aaaaaaaa"}');
    } finally {
      vi.doUnmock('./hash');
      vi.resetModules();
    }
  });
});
