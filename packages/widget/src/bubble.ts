export type Draft = { text: string };

export type DraftEvent = { type: 'text'; text: string } | { type: 'reset' };

export const EMPTY_DRAFT: Draft = { text: '' };

export function draftReducer(draft: Draft, event: DraftEvent): Draft {
  switch (event.type) {
    case 'text':
      return { text: event.text };
    case 'reset':
      return EMPTY_DRAFT;
  }
}

export function readyComment(draft: Draft): string | null {
  const trimmed = draft.text.trim();
  return trimmed === '' ? null : trimmed;
}

export const DEFAULT_MARK_COMMENT = 'See the marked element.';

export function readyMark(draft: Draft): string {
  return readyComment(draft) ?? DEFAULT_MARK_COMMENT;
}

export type BubbleKey = { key: string; shiftKey: boolean; isComposing?: boolean };

export function bubbleKey(event: BubbleKey, draft: Draft): 'send' | 'newline' | 'cancel' | null {
  if (event.isComposing === true) {
    return null;
  }
  if (event.key === 'Enter') {
    return event.shiftKey ? 'newline' : readyComment(draft) !== null ? 'send' : null;
  }
  if (event.key === 'Escape') {
    return 'cancel';
  }
  return null;
}
