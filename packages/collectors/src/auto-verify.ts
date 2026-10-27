import type { Annotation, Rect } from '@passback/schema';
import { checkAnnotation } from './annotation-check';

export type AutoVerify = {
  verdict: 'closed' | 'open' | 'unchecked';
  failed: { annotation: Annotation; actual: number }[];
};

const CONSIDERED_TYPES = ['align', 'gap', 'no-overlap', 'move'] as const;
type ConsideredType = (typeof CONSIDERED_TYPES)[number];

function isConsideredType(type: string): type is ConsideredType {
  return (CONSIDERED_TYPES as readonly string[]).includes(type);
}

export function autoVerify(
  annotations: readonly Annotation[],
  rectsAfter: Readonly<Record<string, Rect>>,
  tolerance?: number,
): AutoVerify {
  const considered = annotations.filter((annotation) => isConsideredType(annotation.type));
  if (considered.length === 0) return { verdict: 'unchecked', failed: [] };

  const failed: { annotation: Annotation; actual: number }[] = [];
  let undecidable = false;

  for (const annotation of considered) {
    if (annotation.type === 'move') {
      undecidable = true;
      continue;
    }
    const result = checkAnnotation(annotation, rectsAfter, tolerance);
    if (!result.checked) {
      undecidable = true;
    } else if (!result.holds) {
      failed.push({ annotation, actual: result.actual });
    }
  }

  if (failed.length > 0) return { verdict: 'open', failed };
  if (undecidable) return { verdict: 'unchecked', failed: [] };
  return { verdict: 'closed', failed: [] };
}
