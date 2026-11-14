import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureWidgetArtifact } from './global-setup';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'passback-widget-artifact-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('ensureWidgetArtifact', () => {
  it('builds the artifact when it is missing', () => {
    const artifact = join(dir, 'passback.js');
    const build = vi.fn(() => {
      writeFileSync(artifact, 'export {};');
    });

    ensureWidgetArtifact(artifact, build);

    expect(build).toHaveBeenCalledTimes(1);
    expect(readFileSync(artifact, 'utf8')).toBe('export {};');
  });

  it('does not build when the artifact already exists', () => {
    const artifact = join(dir, 'passback.js');
    writeFileSync(artifact, 'export {};');
    const build = vi.fn();

    ensureWidgetArtifact(artifact, build);

    expect(build).not.toHaveBeenCalled();
  });

  it('throws when the build leaves the artifact missing', () => {
    const artifact = join(dir, 'passback.js');
    const build = vi.fn();

    expect(() => ensureWidgetArtifact(artifact, build)).toThrow(artifact);
    expect(existsSync(artifact)).toBe(false);
  });
});
