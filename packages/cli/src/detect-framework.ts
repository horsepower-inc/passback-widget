export type DetectedFramework = 'next' | 'vite-react' | 'vite' | 'none';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function depNames(pkg: Record<string, unknown>, field: string): string[] {
  const value = pkg[field];
  return isPlainObject(value) ? Object.keys(value) : [];
}

/** Pure detection of the customer's framework from a parsed `package.json`. */
export function detectFramework(pkg: unknown): DetectedFramework {
  if (!isPlainObject(pkg)) {
    return 'none';
  }

  const names = new Set([...depNames(pkg, 'dependencies'), ...depNames(pkg, 'devDependencies')]);

  if (names.has('next')) {
    return 'next';
  }
  if (names.has('vite') && names.has('react')) {
    return 'vite-react';
  }
  if (names.has('vite')) {
    return 'vite';
  }
  return 'none';
}
