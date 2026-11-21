import { describe, expect, it } from 'vitest';
import {
  diffSnapshotFiles,
  diffSnapshots,
  parseSnapshotFile,
  snapshotKey,
  type RectSnapshot,
} from './geometry-diff';

const rect = (x: number, y: number, width = 10, height = 10) => ({ x, y, width, height });

function snap(
  rects: RectSnapshot['rects'],
  route = '/cart',
  viewport: [number, number] = [375, 812],
) {
  return { v: 1, route, viewport, rects } satisfies RectSnapshot;
}

describe('diffSnapshots', () => {
  it('ignores a 1px move', () => {
    const diff = diffSnapshots(snap({ a: rect(0, 0) }), snap({ a: rect(1, 1) }));
    expect(diff).toEqual({ key: '/cart@375x812', moved: [], resized: [], added: [], removed: [] });
  });

  it('reports a 2px move', () => {
    const diff = diffSnapshots(snap({ a: rect(0, 0) }), snap({ a: rect(2, 0) }));
    expect(diff.moved).toEqual(['a']);
  });

  it('reports a resize, not a move, when the size changed', () => {
    const diff = diffSnapshots(snap({ a: rect(0, 0) }), snap({ a: rect(5, 5, 20, 10) }));
    expect(diff.resized).toEqual(['a']);
    expect(diff.moved).toEqual([]);
  });

  it('reports added and removed names in sorted order', () => {
    const diff = diffSnapshots(
      snap({ z: rect(0, 0), y: rect(0, 0), k: rect(0, 0) }),
      snap({ k: rect(0, 0), c: rect(0, 0), b: rect(0, 0) }),
    );
    expect(diff.added).toEqual(['b', 'c']);
    expect(diff.removed).toEqual(['y', 'z']);
  });

  it('throws for snapshots of different viewports', () => {
    expect(() => diffSnapshots(snap({}), snap({}, '/cart', [1280, 800]))).toThrow(
      'snapshots differ in route or viewport',
    );
  });
});

describe('snapshot files', () => {
  it('pairs snapshot files by route and viewport and lists unpaired keys', () => {
    const base = {
      v: 1 as const,
      snapshots: [snap({ a: rect(0, 0) }), snap({}, '/b'), snap({}, '/z')],
    };
    const head = {
      v: 1 as const,
      snapshots: [snap({ a: rect(9, 0) }), snap({}, '/a'), snap({}, '/b', [1, 1])],
    };
    const result = diffSnapshotFiles(base, head);
    expect(snapshotKey(base.snapshots[0]!)).toBe('/cart@375x812');
    expect(result.diffs.map((d) => d.key)).toEqual(['/cart@375x812']);
    expect(result.diffs[0]?.moved).toEqual(['a']);
    expect(result.onlyInBase).toEqual(['/b@375x812', '/z@375x812']);
    expect(result.onlyInHead).toEqual(['/a@375x812', '/b@1x1']);
  });

  it('parses a snapshot file and rejects malformed text', () => {
    const file = { v: 1, snapshots: [snap({ a: rect(0, 0) })] };
    expect(parseSnapshotFile(JSON.stringify(file))).toEqual(file);
    expect(() => parseSnapshotFile('{nope secret')).toThrow('invalid snapshot file: not JSON');
    expect(() => parseSnapshotFile('{"v":2,"snapshots":[]}')).toThrow('invalid snapshot file:');
    expect(() =>
      parseSnapshotFile('{"v":1,"snapshots":[{"route":"/","viewport":[1],"rects":{}}]}'),
    ).toThrow('invalid snapshot file: viewport');
    expect(() =>
      parseSnapshotFile(
        '{"v":1,"snapshots":[{"route":"/","viewport":[1,2],"rects":{"a":{"x":1}}}]}',
      ),
    ).toThrow('invalid snapshot file: a rect');
  });
});
