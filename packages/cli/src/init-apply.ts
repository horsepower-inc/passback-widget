export interface InitWrite {
  path: string;
  text: string;
}

/** Splits the plan's writes into what init writes now and what it only shows; `--apply` writes all of them. */
export function splitInitWrites(
  writes: InitWrite[],
  options: { apply: boolean; pluginOnDisk: Set<string> },
): { write: InitWrite[]; planned: InitWrite[] } {
  if (options.apply) {
    return { write: writes, planned: [] };
  }
  const write: InitWrite[] = [];
  const planned: InitWrite[] = [];
  for (const w of writes) {
    (w.path === '.gitignore' || options.pluginOnDisk.has(w.path) ? write : planned).push(w);
  }
  return { write, planned };
}

/** The lines init prints for files it did not write: the path, the file text and an empty line. */
export function formatPlanned(planned: InitWrite[]): string[] {
  return planned.flatMap((w) => [`not written (add --apply to write it): ${w.path}`, w.text, '']);
}
