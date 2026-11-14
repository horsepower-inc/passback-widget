import { describe, expect, it } from 'vitest';
import { detectFramework } from './detect-framework';

describe('detectFramework', () => {
  it('names next when next is a dependency, even beside vite and react', () => {
    expect(
      detectFramework({ dependencies: { next: '14.0.0', vite: '5.0.0', react: '18.0.0' } }),
    ).toBe('next');
  });

  it('names vite-react when vite and react are both present', () => {
    expect(detectFramework({ dependencies: { vite: '5.0.0', react: '18.0.0' } })).toBe(
      'vite-react',
    );
  });

  it('names vite when vite is present without react', () => {
    expect(detectFramework({ dependencies: { vite: '5.0.0' } })).toBe('vite');
  });

  it('reads devDependencies as well as dependencies', () => {
    expect(
      detectFramework({
        dependencies: { react: '18.0.0' },
        devDependencies: { vite: '5.0.0' },
      }),
    ).toBe('vite-react');
  });

  it('names none for a package with neither vite nor next', () => {
    expect(detectFramework({ dependencies: { react: '18.0.0' } })).toBe('none');
  });

  it('names none for input that is not an object', () => {
    expect(detectFramework(null)).toBe('none');
    expect(detectFramework([])).toBe('none');
    expect(detectFramework('vite')).toBe('none');
    expect(detectFramework(42)).toBe('none');
  });

  it('ignores a dependencies field that is not an object', () => {
    expect(detectFramework({ dependencies: 'vite', devDependencies: { vite: '5.0.0' } })).toBe(
      'vite',
    );
  });
});
