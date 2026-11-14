import { describe, expect, it, vi } from 'vitest';
import loader from './loader';

const SRC = 'export default function P() { return <div />; }';

function run(resourcePath: string, source: string, root = '/r') {
  const callback = vi.fn();
  loader.call({ resourcePath, getOptions: () => ({ root }), callback }, source);
  return callback;
}

describe('passbackLoader', () => {
  it('adds data-source with the root-relative path to a host element of a tsx file', () => {
    const callback = run('/r/app/page.tsx', SRC);
    expect(callback.mock.calls[0]?.[1]).toContain('data-source={"app/page.tsx:1:38"}');
  });

  it('names a nested file by its root-relative path', () => {
    const callback = run('/r/app/a/b/card.tsx', SRC);
    expect(callback.mock.calls[0]?.[1]).toContain('data-source={"app/a/b/card.tsx:1:38"}');
  });

  it('adds data-source to a jsx file', () => {
    const callback = run('/r/app/page.jsx', SRC);
    expect(callback.mock.calls[0]?.[1]).toContain('data-source={"app/page.jsx:1:38"}');
  });

  it('leaves a file under node_modules unchanged', () => {
    const callback = run('/r/node_modules/x/index.tsx', SRC);
    expect(callback).toHaveBeenCalledWith(null, SRC);
  });

  it('leaves a .ts file unchanged', () => {
    const callback = run('/r/app/util.ts', SRC);
    expect(callback).toHaveBeenCalledWith(null, SRC);
  });

  it('leaves a file outside the root unchanged', () => {
    const callback = run('/other/page.tsx', SRC);
    expect(callback).toHaveBeenCalledWith(null, SRC);
  });

  it('leaves source that does not parse unchanged', () => {
    const bad = 'export default <div';
    const callback = run('/r/app/page.tsx', bad);
    expect(callback).toHaveBeenCalledWith(null, bad);
  });

  it('strips a query from the resource path and maps the result to the absolute file', () => {
    const callback = run('/r/app/page.tsx?v=1', SRC);
    const [error, content, map] = callback.mock.calls[0] ?? [];
    expect(error).toBeNull();
    expect(content).toContain('data-source={"app/page.tsx:1:38"}');
    expect((map as { sources: string[] }).sources).toEqual(['/r/app/page.tsx']);
  });
});
