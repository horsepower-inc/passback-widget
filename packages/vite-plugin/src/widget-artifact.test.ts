import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readWidgetFile } from './widget-artifact';

describe('readWidgetFile', () => {
  let dir: string;
  const from = () => pathToFileURL(join(dir, 'index.js'));

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'passback-artifact-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function writeAdjacent(file: string, content: string): string {
    mkdirSync(join(dir, 'widget'), { recursive: true });
    const path = join(dir, 'widget', file);
    writeFileSync(path, content);
    return path;
  }

  it('prefers the file next to the module over the workspace package', () => {
    const path = writeAdjacent('passback.js', 'adjacent-bytes');
    const result = readWidgetFile('passback.js', from());
    expect(result.path).toBe(path);
    expect(result.bytes.toString()).toBe('adjacent-bytes');
  });

  it('falls back to the workspace package when nothing is next to the module', () => {
    const result = readWidgetFile('passback.js', from());
    expect(result.path.endsWith('packages/widget/dist/passback.js')).toBe(true);
    expect(result.bytes.equals(readFileSync(result.path))).toBe(true);
  });

  it('treats an empty file next to the module as absent and falls back', () => {
    writeAdjacent('passback.js', '');
    const result = readWidgetFile('passback.js', from());
    expect(result.path.endsWith('packages/widget/dist/passback.js')).toBe(true);
    expect(result.bytes.byteLength).toBeGreaterThan(0);
  });

  it('reads the collector chunk by the same rule', () => {
    const path = writeAdjacent('passback-collect.js', 'adjacent-chunk');
    const result = readWidgetFile('passback-collect.js', from());
    expect(result.path).toBe(path);
    expect(result.bytes.toString()).toBe('adjacent-chunk');
  });
});
