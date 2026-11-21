/** Reads `--name value` / `--flag` pairs; undefined when a flag is unknown or lacks its value. */
export function readFlags(
  rest: string[],
  valued: string[],
  bare: string[],
): { values: Map<string, string>; bare: Set<string> } | undefined {
  const values = new Map<string, string>();
  const seen = new Set<string>();
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i] as string;
    if (bare.includes(arg)) {
      seen.add(arg);
    } else if (valued.includes(arg)) {
      const value = rest[i + 1];
      if (value === undefined || value.startsWith('--')) {
        return undefined;
      }
      values.set(arg, value);
      i++;
    } else {
      return undefined;
    }
  }
  return { values, bare: seen };
}
