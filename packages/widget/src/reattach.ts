export type OpenMark = { id: string };

export type Reattached<M extends OpenMark> =
  { mark: M; element: Element; orphaned: false } | { mark: M; element: null; orphaned: true };

export function reattachMarks<M extends OpenMark>(
  marks: readonly M[],
  resolve: (mark: M) => Element | null,
): Reattached<M>[] {
  return marks.map((mark) => {
    let element: Element | null;
    try {
      element = resolve(mark);
    } catch {
      element = null;
    }
    return element === null
      ? { mark, element: null, orphaned: true }
      : { mark, element, orphaned: false };
  });
}

export function orphanedIds(results: readonly Reattached<OpenMark>[]): string[] {
  return results.filter((result) => result.orphaned).map((result) => result.mark.id);
}
