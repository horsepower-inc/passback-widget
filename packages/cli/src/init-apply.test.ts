import { describe, expect, it } from 'vitest';
import { formatPlanned, splitInitWrites } from './init-apply';

const WRITES = [
  { path: '.mcp.json', text: 'mcp' },
  { path: 'vite.config.ts', text: 'vite' },
  { path: '.gitignore', text: 'ignore' },
  { path: 'AGENTS.md', text: 'agents' },
];

describe('splitInitWrites', () => {
  it('writes only the gitignore when apply is off', () => {
    const { write, planned } = splitInitWrites(WRITES, { apply: false, pluginOnDisk: new Set() });
    expect(write.map((w) => w.path)).toEqual(['.gitignore']);
    expect(planned.map((w) => w.path)).toEqual(['.mcp.json', 'vite.config.ts', 'AGENTS.md']);
  });

  it('keeps a write whose plugin is already on disk', () => {
    const { write, planned } = splitInitWrites(WRITES, {
      apply: false,
      pluginOnDisk: new Set(['vite.config.ts']),
    });
    expect(write.map((w) => w.path)).toEqual(['vite.config.ts', '.gitignore']);
    expect(planned.map((w) => w.path)).toEqual(['.mcp.json', 'AGENTS.md']);
  });

  it('writes every file when apply is on', () => {
    const { write, planned } = splitInitWrites(WRITES, { apply: true, pluginOnDisk: new Set() });
    expect(write).toEqual(WRITES);
    expect(planned).toEqual([]);
  });
});

describe('formatPlanned', () => {
  it('formats a planned file as a not-written line and its text', () => {
    expect(formatPlanned([{ path: 'AGENTS.md', text: 'hello' }])).toEqual([
      'not written (add --apply to write it): AGENTS.md',
      'hello',
      '',
    ]);
  });
});
