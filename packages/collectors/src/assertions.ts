import type { Annotation, Rect } from '@passback/schema';
import { checkAnnotation } from './annotation-check';

export type AssertionFile = {
  v: 1;
  markId: string;
  viewport: [number, number];
  annotations: Annotation[];
};

const GEOMETRIC_TYPES = ['align', 'gap', 'no-overlap'] as const;
type GeometricType = (typeof GEOMETRIC_TYPES)[number];

const MARK_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

function isGeometricType(type: string): type is GeometricType {
  return (GEOMETRIC_TYPES as readonly string[]).includes(type);
}

function isGeometricAnnotation(value: unknown): value is Annotation {
  if (typeof value !== 'object' || value === null || !('type' in value)) return false;
  const type = (value as { type: unknown }).type;
  return typeof type === 'string' && isGeometricType(type);
}

export function assertionFile(
  markId: string,
  annotations: readonly Annotation[],
  viewport: [number, number],
): { name: string; text: string } | undefined {
  if (!MARK_ID_PATTERN.test(markId)) {
    throw new Error(`invalid mark id: ${markId}`);
  }

  const kept = annotations.filter((annotation) => isGeometricType(annotation.type));
  if (kept.length === 0) return undefined;

  const file: AssertionFile = { v: 1, markId, viewport, annotations: kept };
  return { name: `${markId}.json`, text: JSON.stringify(file, null, 2) + '\n' };
}

function isViewport(value: unknown): value is [number, number] {
  return Array.isArray(value) && value.length === 2 && value.every((n) => typeof n === 'number');
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('invalid assertion file: not valid JSON');
  }
}

export function parseAssertionFile(text: string): AssertionFile {
  const parsed = parseJson(text);

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('invalid assertion file: not an object');
  }

  const { v, markId, viewport, annotations } = parsed as Record<string, unknown>;

  if (v !== 1) {
    throw new Error('invalid assertion file: v must be 1');
  }
  if (typeof markId !== 'string') {
    throw new Error('invalid assertion file: markId must be a string');
  }
  if (!isViewport(viewport)) {
    throw new Error('invalid assertion file: viewport must be two numbers');
  }
  if (!Array.isArray(annotations) || !annotations.every(isGeometricAnnotation)) {
    throw new Error('invalid assertion file: annotations must be align, gap or no-overlap');
  }

  return { v: 1, markId, viewport, annotations };
}

export function failedAssertions(
  file: AssertionFile,
  rects: Readonly<Record<string, Rect>>,
  tolerance?: number,
): { annotation: Annotation; actual: number }[] {
  const failures: { annotation: Annotation; actual: number }[] = [];
  for (const annotation of file.annotations) {
    const result = checkAnnotation(annotation, rects, tolerance);
    if (result.checked && !result.holds) {
      failures.push({ annotation, actual: result.actual });
    }
  }
  return failures;
}
