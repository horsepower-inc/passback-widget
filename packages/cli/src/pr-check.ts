// `passback pr-check`: diffs two rect snapshot files, lints the head layout and checks assertion files.
//
// Nothing in passback writes assertion files yet (`assertionFile()` has no caller), so the
// assertions half is exercised by hand-written files only.

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  diffSnapshotFiles,
  failedAssertions,
  lintLayout,
  parseAssertionFile,
  parseSnapshotFile,
  snapshotKey,
  type AssertionFile,
  type LayoutFinding,
  type SnapshotDiff,
  type SnapshotFile,
} from '@passback/collectors/geometry';

type Io = { out(line: string): void; err(line: string): void };

type KeyedFinding = LayoutFinding & { key: string };
type FailedAssertion = {
  key: string;
  file: string;
  markId: string;
  annotation: Annotation;
  actual: number;
};

type Annotation = AssertionFile['annotations'][number];

class FileError extends Error {}

async function readSnapshots(file: string): Promise<SnapshotFile> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch {
    throw new FileError(`cannot read ${file}`);
  }
  try {
    return parseSnapshotFile(text);
  } catch (err) {
    throw new FileError(`${file}: ${err instanceof Error ? err.message : 'invalid snapshot file'}`);
  }
}

async function checkAssertionFiles(dir: string, head: SnapshotFile): Promise<FailedAssertion[]> {
  let names: string[];
  try {
    names = (await readdir(dir)).filter((n) => n.endsWith('.json')).sort();
  } catch {
    throw new FileError(`cannot read ${dir}`);
  }
  const failed: FailedAssertion[] = [];
  for (const name of names) {
    const file = path.join(dir, name);
    let parsed;
    try {
      parsed = parseAssertionFile(await readFile(file, 'utf8'));
    } catch (err) {
      throw new FileError(`${file}: ${err instanceof Error ? err.message : 'cannot read'}`);
    }
    for (const snapshot of head.snapshots) {
      if (
        snapshot.viewport[0] !== parsed.viewport[0] ||
        snapshot.viewport[1] !== parsed.viewport[1]
      ) {
        continue;
      }
      // `parseAssertionFile` does not validate every annotation's fields; one the checker
      // cannot read makes the file malformed (exit 2), not a crash.
      let failures;
      try {
        failures = failedAssertions(parsed, snapshot.rects);
      } catch {
        throw new FileError(`${file}: invalid assertion file`);
      }
      for (const f of failures) {
        failed.push({
          key: snapshotKey(snapshot),
          file: name,
          markId: parsed.markId,
          annotation: f.annotation,
          actual: f.actual,
        });
      }
    }
  }
  return failed;
}

function describeAnnotation(a: Annotation): string {
  switch (a.type) {
    case 'align':
      return `align ${a.edge} of ${a.a} and ${a.b}`;
    case 'gap':
      return `gap between ${a.a} and ${a.b} expected ${a.expected}`;
    case 'no-overlap':
      return `no-overlap of ${a.elements.join(', ')}`;
    default:
      return a.type;
  }
}

type Result = {
  status: string;
  diffs: SnapshotDiff[];
  findings: KeyedFinding[];
  failed: FailedAssertion[];
  onlyInBase: string[];
  onlyInHead: string[];
};

function report({ status, diffs, findings, failed, onlyInBase, onlyInHead }: Result): string[] {
  const changed = diffs.filter(
    (d) => d.moved.length + d.resized.length + d.added.length + d.removed.length > 0,
  );
  const count = changed.reduce(
    (n, d) => n + d.moved.length + d.resized.length + d.added.length + d.removed.length,
    0,
  );
  const lines = [
    `passback pr-check: ${status} (${findings.length} layout findings, ${failed.length} failed assertions, ${count} changed elements)`,
  ];
  const section = (title: string, body: string[]): void => {
    if (body.length === 0) return;
    lines.push('', `### ${title}`, ...body);
  };
  section(
    'Changed',
    changed.flatMap((d) => {
      const parts = (['moved', 'resized', 'added', 'removed'] as const)
        .filter((k) => d[k].length > 0)
        .map((k) => `${k} ${d[k].join(', ')}`);
      return [`- ${d.key}: ${parts.join('; ')}`];
    }),
  );
  section(
    'Layout findings',
    findings.map((f) => `- ${f.key}: ${f.kind} ${f.names.join(', ')}`),
  );
  section(
    'Failed assertions',
    failed.map(
      (f) =>
        `- ${f.key}: ${f.markId} (${f.file}): ${describeAnnotation(f.annotation)}, actual ${f.actual}`,
    ),
  );
  section('Not compared', [
    ...onlyInBase.map((k) => `- ${k}: only in base`),
    ...onlyInHead.map((k) => `- ${k}: only in head`),
  ]);
  return lines;
}

export async function runPrCheck(
  opts: { base: string; head: string; assertionsDir?: string; json: boolean },
  io: Io,
): Promise<0 | 1 | 2> {
  let base: SnapshotFile;
  let head: SnapshotFile;
  let failed: FailedAssertion[] = [];
  try {
    base = await readSnapshots(opts.base);
    head = await readSnapshots(opts.head);
    if (opts.assertionsDir !== undefined)
      failed = await checkAssertionFiles(opts.assertionsDir, head);
  } catch (err) {
    if (!(err instanceof FileError)) throw err;
    io.err(`passback pr-check: ${err.message}`);
    return 2;
  }
  const { diffs, onlyInBase, onlyInHead } = diffSnapshotFiles(base, head);
  const findings: KeyedFinding[] = head.snapshots.flatMap((s) =>
    lintLayout(s.rects, { width: s.viewport[0], height: s.viewport[1] }).map((f) => ({
      ...f,
      key: snapshotKey(s),
    })),
  );
  const status = findings.length + failed.length > 0 ? 'findings' : 'pass';
  const result: Result = { status, diffs, findings, failed, onlyInBase, onlyInHead };
  if (opts.json) {
    io.out(JSON.stringify(result));
  } else {
    for (const line of report(result)) io.out(line);
  }
  return status === 'pass' ? 0 : 1;
}
