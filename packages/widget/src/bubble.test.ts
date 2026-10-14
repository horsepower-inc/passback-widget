import { describe, expect, it } from 'vitest';
import { EMPTY_DRAFT, bubbleKey, draftReducer, readyComment } from './bubble';
import type { Draft } from './bubble';

describe('bubble', () => {
  it('starts empty', () => {
    expect(EMPTY_DRAFT).toEqual({ text: '' });
  });

  it('a text event replaces the text verbatim', () => {
    const draft = draftReducer(EMPTY_DRAFT, { type: 'text', text: '  hi  ' });
    expect(draft).toEqual({ text: '  hi  ' });
  });

  it('reset returns the empty draft', () => {
    const draft = draftReducer({ text: 'something' }, { type: 'reset' });
    expect(draft).toEqual(EMPTY_DRAFT);
  });

  it('does not mutate the draft it is given', () => {
    const original: Draft = { text: 'original' };
    const frozen = Object.freeze({ ...original });
    draftReducer(frozen, { type: 'text', text: 'changed' });
    expect(frozen).toEqual({ text: 'original' });
  });

  it('readyComment is null for an empty or whitespace-only text', () => {
    expect(readyComment({ text: '' })).toBeNull();
    expect(readyComment({ text: '   ' })).toBeNull();
    expect(readyComment({ text: '\n\t' })).toBeNull();
  });

  it('readyComment trims the text', () => {
    expect(readyComment({ text: '  hello world  ' })).toBe('hello world');
  });

  it('Enter sends a non-blank draft', () => {
    const result = bubbleKey({ key: 'Enter', shiftKey: false }, { text: 'hello' });
    expect(result).toBe('send');
  });

  it('Enter on a blank draft does nothing', () => {
    const result = bubbleKey({ key: 'Enter', shiftKey: false }, { text: '   ' });
    expect(result).toBeNull();
  });

  it('Shift+Enter inserts a newline', () => {
    const result = bubbleKey({ key: 'Enter', shiftKey: true }, { text: 'hello' });
    expect(result).toBe('newline');
  });

  it('Escape cancels', () => {
    const result = bubbleKey({ key: 'Escape', shiftKey: false }, { text: 'hello' });
    expect(result).toBe('cancel');
  });

  it('keys during an IME composition do nothing', () => {
    expect(
      bubbleKey({ key: 'Enter', shiftKey: false, isComposing: true }, { text: 'hello' }),
    ).toBeNull();
    expect(
      bubbleKey({ key: 'Escape', shiftKey: false, isComposing: true }, { text: 'hello' }),
    ).toBeNull();
  });
});
