const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

export function commentableLines(patch: string | undefined): Set<number> {
  const lines = new Set<number>();
  if (!patch) return lines;
  let next: number | undefined;
  const body = patch.endsWith('\n') ? patch.slice(0, -1) : patch;
  for (const line of body.split('\n')) {
    if (line.startsWith('@@')) {
      const match = HUNK_HEADER.exec(line);
      next = match ? Number(match[1]) : undefined;
      continue;
    }
    if (next === undefined || line.startsWith('\\') || line.startsWith('-')) continue;
    lines.add(next);
    next += 1;
  }
  return lines;
}
