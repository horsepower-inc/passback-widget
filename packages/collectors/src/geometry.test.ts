import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as geometry from './geometry';

describe('geometry subpath', () => {
  it('exposes the measuring functions and the diff from one subpath', () => {
    for (const name of [
      'lintLayout',
      'autoVerify',
      'failedAssertions',
      'parseAssertionFile',
      'checkAnnotation',
      'snapshotKey',
      'diffSnapshots',
      'diffSnapshotFiles',
      'parseSnapshotFile',
    ] as const) {
      expect(typeof geometry[name]).toBe('function');
    }
  });

  it('keeps the measuring functions out of the package index', () => {
    const index = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
    for (const name of ['layout-lint', 'auto-verify', 'assertions', 'geometry']) {
      expect(index).not.toContain(name);
    }
  });
});
