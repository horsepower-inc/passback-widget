import { wrapNextConfig } from './next-config';

// The shape of InitWrite, declared here so next-files.ts never imports init-plan.ts.
export type NextWrite = { path: string; text: string };

export type NextAppInput = {
  dir: string;
  rootRelative: string;
  srcApp: boolean;
  routeExists: boolean;
  config?: { path: string; text: string };
  layout?: { path: string; text: string };
};

export type NextAppPlan = { writes: NextWrite[]; printed: string[] };

export const NEXT_ROUTE_TEXT =
  "export { GET, POST } from '@passback/next/route';\n" +
  "export const runtime = 'nodejs';\n" +
  "export const dynamic = 'force-dynamic';\n";

function inDir(dir: string, path: string): string {
  return dir === '.' ? path : `${dir}/${path}`;
}

export function nextRoutePath(dir: string, srcApp: boolean): string {
  return inDir(dir, `${srcApp ? 'src/' : ''}app/api/passback/[[...path]]/route.ts`);
}

/** Pure plan of what init writes and prints for one Next app. */
export function planNextApp(input: NextAppInput): NextAppPlan {
  const { dir, rootRelative, config } = input;
  const writes: NextWrite[] = [];
  const printed: string[] = [];

  if (!input.routeExists) {
    writes.push({ path: nextRoutePath(dir, input.srcApp), text: NEXT_ROUTE_TEXT });
  }

  if (config === undefined) {
    writes.push({
      path: inDir(dir, 'next.config.mjs'),
      text:
        "import { withPassback } from '@passback/next';\n" +
        `export default withPassback({}, { root: '${rootRelative}' });\n`,
    });
  } else {
    const wrapped = wrapNextConfig(config.text, rootRelative);
    if (!wrapped.ok) {
      printed.push(
        `${dir}: next.config left as it is (${wrapped.reason}); wrap its export by hand: withPassback(config, { root: '${rootRelative}' })`,
      );
    } else if (wrapped.changed) {
      writes.push({ path: config.path, text: wrapped.text });
    }
  }

  const layoutLine = planLayout(input, writes);
  if (layoutLine !== undefined) {
    printed.push(layoutLine);
  }
  printed.push(`${dir}: install it: npm i -D @passback/next`);
  return { writes, printed };
}

const PASSBACK_IMPORT = "import { Passback } from '@passback/next'";

/** Pushes the layout write when the edit changes it; returns the line to print, if any. */
function planLayout({ dir, layout }: NextAppInput, writes: NextWrite[]): string | undefined {
  if (layout === undefined) {
    return `${dir}: add <Passback /> inside <head> of the layout that renders <html>: ${PASSBACK_IMPORT}`;
  }
  const edit = addPassbackTag(layout.text);
  if (!edit.ok) {
    return `${dir}: ${layout.path} left as it is (${edit.reason}); add <Passback /> inside <head> by hand: ${PASSBACK_IMPORT}`;
  }
  if (edit.changed) {
    writes.push({ path: layout.path, text: edit.text });
  }
  return undefined;
}

export type LayoutEdit =
  | { ok: true; changed: boolean; text: string }
  | { ok: false; reason: string };

const IMPORT_LINE = /^import .*['"];?$/;

const once = (text: string, re: RegExp): boolean => text.split(re).length === 2;

function isRecognised(text: string): boolean {
  const head = !text.includes('<head') || (once(text, /<head[\s>]/) && once(text, /<\/head>/) && text.search(/<head[\s>]/) < text.indexOf('</head>'));
  return head && once(text, /<html[\s>]/) && once(text, /<body[\s>]/) && text.split('\n').some((l) => IMPORT_LINE.test(l));
}

/** Inserts before the tag at `at`: `lines` before its line when only spaces precede it, else `inline`. */
function insertAt(text: string, at: number, lines: string[], inline: string): string {
  const start = text.lastIndexOf('\n', at - 1) + 1;
  const indent = text.slice(start, at);
  return /^ *$/.test(indent)
    ? text.slice(0, start) + lines.map((l) => `${indent}${l}\n`).join('') + text.slice(start)
    : text.slice(0, at) + inline + text.slice(at);
}

function insertTag(text: string): string {
  const close = text.indexOf('</head>');
  if (close !== -1) {
    return insertAt(text, close, ['  <Passback />'], '<Passback />');
  }
  return insertAt(text, text.search(/<body[\s>]/), ['<head>', '  <Passback />', '</head>'], '<head><Passback /></head>');
}

function addImport(text: string): string {
  const lines = text.split('\n');
  lines.splice(lines.map((l) => IMPORT_LINE.test(l)).lastIndexOf(true) + 1, 0, `${PASSBACK_IMPORT};`);
  return lines.join('\n');
}

/** Pure edit of a Next root layout: the tag in <head> and its import, or a refusal. */
export function addPassbackTag(text: string): LayoutEdit {
  if (text.includes('<Passback')) {
    return { ok: true, changed: false, text };
  }
  if (!isRecognised(text)) {
    return { ok: false, reason: 'unrecognised layout shape' };
  }
  return { ok: true, changed: true, text: addImport(insertTag(text)) };
}
