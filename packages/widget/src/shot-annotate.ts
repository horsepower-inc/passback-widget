import type { Annotation } from '@passback/schema';
import type { Pt, Shape } from './shot-shapes';

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// Free-form annotations are offsets in CSS px from the marked element's top-left corner.
// A line has no annotation type in the contract yet, so it travels in the picture only.
export function toAnnotations(
  shapes: readonly Shape[],
  rect: { left: number; top: number },
): Annotation[] {
  const rel = (p: Pt): Pt => ({ x: round1(p.x - rect.left), y: round1(p.y - rect.top) });
  const out: Annotation[] = [];
  for (const s of shapes) {
    if (s.tool === 'arrow') out.push({ type: 'arrow', from: rel(s.from), to: rel(s.to) });
    else if (s.tool === 'box') out.push({ type: 'box', from: rel(s.from), to: rel(s.to) });
  }
  return out;
}
