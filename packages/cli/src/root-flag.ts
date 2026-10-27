export function readRoot(rest: string[]): { root?: string } | undefined {
  const rootIndex = rest.indexOf('--root');
  if (rootIndex === -1) {
    return {};
  }
  const root = rest[rootIndex + 1];
  if (root === undefined || root.startsWith('--')) {
    return undefined;
  }
  return { root };
}
