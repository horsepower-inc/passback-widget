import { describe, expect, it } from 'vitest';
import { createHighlight } from './inbox-highlight';

function setup() {
  const host = new EventTarget();
  const ids: Array<string | null> = [];
  host.addEventListener('passback:highlight', (e) =>
    ids.push((e as CustomEvent<{ id: string | null }>).detail.id),
  );
  return { host, ids, hl: createHighlight(host) };
}

describe('inbox highlight', () => {
  it('dispatches the hovered id on the host and null when the pointer leaves', () => {
    const { hl, ids } = setup();
    hl.hover('a');
    hl.hover(null);
    expect(ids).toEqual(['a', null]);
  });

  it('shows the open task id when nothing is hovered and the hovered id over it', () => {
    const { hl, ids } = setup();
    hl.open('t');
    hl.hover('a');
    hl.hover('b');
    hl.hover(null);
    hl.open(null);
    expect(ids).toEqual(['t', 'a', 'b', 't', null]);
  });

  it('dispatches nothing when the shown id does not change', () => {
    const { hl, ids } = setup();
    hl.hover(null);
    hl.open(null);
    hl.open('t');
    hl.open('t');
    hl.hover('t');
    expect(ids).toEqual(['t']);
  });

  it('clears the highlight once on dispose and ignores later calls', () => {
    const { hl, ids } = setup();
    hl.hover('a');
    hl.dispose();
    hl.dispose();
    hl.hover('b');
    hl.open('c');
    expect(ids).toEqual(['a', null]);
  });

  it('swallows a dispatchEvent that throws', () => {
    const host = {
      dispatchEvent: (): boolean => {
        throw new Error('x');
      },
    };
    const hl = createHighlight(host as unknown as EventTarget);
    expect(() => (hl.hover('a'), hl.dispose())).not.toThrow();
  });
});
