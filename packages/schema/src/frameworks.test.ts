import { describe, expect, it } from 'vitest';
import { Code } from './payload';
import { FRAMEWORKS } from './frameworks';

describe('FRAMEWORKS', () => {
  it('matches Code.shape.framework.options in order', () => {
    expect(Code.shape.framework.options).toEqual(FRAMEWORKS);
  });
});
