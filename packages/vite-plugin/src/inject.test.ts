import { describe, expect, it } from 'vitest';
import { injectSource } from './inject';

const FILE = 'src/App.tsx';

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

function generateModule(): string {
  const lines = ['export function Component() {', '  return ['];
  for (let i = 0; i < 100; i++) {
    lines.push(`    <div key={${i}} />,`);
  }
  lines.push('  ];', '}');
  const padding = 300 - lines.length;
  for (let i = 0; i < padding; i++) {
    lines.push(`// filler line ${i}`);
  }
  return lines.join('\n');
}

describe('injectSource', () => {
  it('adds data-source with 1-based line and column to a host element', () => {
    const result = injectSource('const a = <div />;', FILE);
    expect(result?.code).toBe('const a = <div data-source={"src/App.tsx:1:11"} />;');
  });

  it('adds data-source to every nested host element', () => {
    const code = '<div>\n  <span>\n    <p />\n  </span>\n</div>;';
    const result = injectSource(code, FILE);
    expect(count(result?.code ?? '', 'data-source')).toBe(3);
  });

  it('skips capitalised components such as Provider', () => {
    const result = injectSource('<Provider><div /></Provider>;', FILE);
    expect(result?.code).toContain('<div data-source');
    expect(result?.code).not.toContain('<Provider data-source');
  });

  it('skips member-expression tags such as React.Fragment', () => {
    const result = injectSource('<React.Fragment><div /></React.Fragment>;', FILE);
    expect(result?.code).toContain('<div data-source');
    expect(result?.code).not.toContain('<React.Fragment data-source');
  });

  it('skips fragments', () => {
    const result = injectSource('<><div /></>;', FILE);
    expect(result?.code).toContain('<div data-source');
    expect(result?.code).not.toMatch(/<> ?data-source/);
  });

  it('skips an element that carries data-passback-ignore', () => {
    const code = '<div>\n  <span data-passback-ignore />\n  <p />\n</div>;';
    const result = injectSource(code, FILE);
    expect(result?.code).toContain('<span data-passback-ignore />');
    expect(count(result?.code ?? '', 'data-source')).toBe(2);
  });

  it('keeps an existing data-source attribute unchanged', () => {
    const result = injectSource('<div data-source="custom" />;', FILE);
    expect(result).toBeNull();
  });

  it('returns null for a module with no host element', () => {
    const result = injectSource('const a = 1;', FILE);
    expect(result).toBeNull();
  });

  it('returns null for source that does not parse', () => {
    const result = injectSource('const a = <div;', FILE);
    expect(result).toBeNull();
  });

  it('parses TypeScript syntax in a tsx module', () => {
    const result = injectSource('const identity = <T,>(x: T) => <span>{String(x)}</span>;', FILE);
    expect(result?.code).toContain('<span data-source');
  });

  it('writes the value the format callback returns', () => {
    const result = injectSource('<div />;', FILE, () => 'CUSTOM');
    expect(result?.code).toBe('<div data-source={"CUSTOM"} />;');
  });

  it('returns a source map that names the relative path', () => {
    const result = injectSource('<div />;', FILE);
    expect(result?.map.sources).toContain(FILE);
  });

  // 's per-module budget is 5 ms. A shared 2-core CI runner measured medians of 6-10 ms
  // while the other packages' tests ran beside it, so this guards against a
  // complexity regression at 100 ms rather than enforcing the budget itself.
  it('transforms a 300-line module in a median under 100 ms', () => {
    const code = generateModule();
    injectSource(code, FILE);
    const timings: number[] = [];
    for (let i = 0; i < 20; i++) {
      const start = performance.now();
      injectSource(code, FILE);
      timings.push(performance.now() - start);
    }
    timings.sort((a, b) => a - b);
    const median = timings[Math.floor(timings.length / 2)]!;
    expect(median).toBeLessThan(100);
  });
});
