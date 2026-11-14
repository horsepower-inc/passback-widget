import { describe, expect, it } from 'vitest';
import { commentableLines } from './pr-diff-lines';

describe('commentableLines', () => {
  it('counts added and context lines', () => {
    const patch = ['@@ -1,3 +1,4 @@', ' a', '+b', '', ' c'].join('\n');
    expect([...commentableLines(patch)]).toEqual([1, 2, 3, 4]);
  });

  it('skips deleted lines and does not advance the right-hand line', () => {
    const patch = ['@@ -10,4 +10,3 @@', ' a', '-b', '-c', '+d', ' e'].join('\n');
    expect([...commentableLines(patch)]).toEqual([10, 11, 12]);
  });

  it('reads two hunks with their own start lines', () => {
    const patch = ['@@ -1,2 +1,2 @@', ' a', '+b', '@@ -20,2 +30,2 @@', ' c', '+d'].join('\n');
    expect([...commentableLines(patch)]).toEqual([1, 2, 30, 31]);
  });

  it('ignores the no-newline marker', () => {
    const patch = ['@@ -1,2 +1,2 @@', '-a', '\\ No newline at end of file', '+b', '\\ No newline at end of file'].join('\n');
    expect([...commentableLines(patch)]).toEqual([1]);
  });

  it('returns an empty set for an empty or missing patch', () => {
    expect(commentableLines(undefined).size).toBe(0);
    expect(commentableLines('').size).toBe(0);
  });

  it('reads a hunk header that has no length', () => {
    const patch = ['@@ -1 +1 @@', '-a', '+b'].join('\n');
    expect([...commentableLines(patch)]).toEqual([1]);
  });
});
