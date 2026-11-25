import { headInstructions } from './head-instructions';

export const VITE_CONFIG_NAMES = [
  'vite.config.ts',
  'vite.config.mts',
  'vite.config.cts',
  'vite.config.js',
  'vite.config.mjs',
  'vite.config.cjs',
];

// The shape of InitWrite, declared here so vite-files.ts never imports init-plan.ts.
export type ViteWrite = { path: string; text: string };

export type ViteAppInput = {
  dir: string;
  rootRelative: string;
  config?: { path: string; text: string };
  packageJson?: unknown;
};

export type VitePlan = { writes: ViteWrite[]; printed: string[] };

export type ViteEdit = { ok: true; changed: boolean; text: string } | { ok: false; reason: string };

const PACKAGE = '@passback/vite-plugin';
const IMPORT_LINE = `import passback from '${PACKAGE}';`;
const REFUSED: ViteEdit = { ok: false, reason: 'unrecognised vite.config shape' };

function callFor(rootRelative: string): string {
  return rootRelative === '.' ? 'passback()' : `passback({ root: '${rootRelative}' })`;
}

function exportsConfigObject(text: string): boolean {
  const matches = [...text.matchAll(/^export\s+default\s+/gm)];
  const last = matches[matches.length - 1];
  if (last === undefined) {
    return false;
  }
  const rest = text.slice(last.index + last[0].length);
  return (
    rest.startsWith('defineConfig({') ||
    rest.startsWith('{') ||
    /^defineConfig\(\s*(async\s+)?(\([^()]*\)|[A-Za-z_$][\w$]*)\s*=>\s*(\(\s*\{|\{)/.test(rest)
  );
}

/** The index just after the `[` of the one plugins list, or -1 when there is not exactly one. */
function findListStart(text: string): number {
  const matches = [...text.matchAll(/\bplugins\s*:\s*\[/g)];
  const only = matches.length === 1 ? matches[0] : undefined;
  return only === undefined ? -1 : (only.index ?? 0) + only[0].length;
}

function insertCall(text: string, at: number, call: string): string {
  const before = text.slice(0, at);
  const after = text.slice(at);
  const lineEnd = after.indexOf('\n');
  const sameLine = lineEnd === -1 ? after : after.slice(0, lineEnd);
  if (/^ *\]/.test(sameLine)) {
    return `${before}${call}${after.replace(/^ */, '')}`;
  }
  if (lineEnd === 0 || (lineEnd === -1 && after === '')) {
    const indent = /^[ \t]*/.exec(after.slice(lineEnd + 1))?.[0] ?? '';
    return `${before}\n${indent}${call},${after}`;
  }
  return `${before}${call}, ${after}`;
}

function addImport(text: string): string {
  const lines = text.split('\n');
  let last = -1;
  lines.forEach((line, i) => {
    if (/^import .*['"];?$/.test(line)) {
      last = i;
    }
  });
  lines.splice(last + 1, 0, IMPORT_LINE);
  return lines.join('\n');
}

/** Adds the passback() call to the plugins list of a recognised vite.config, or refuses. */
export function addVitePlugin(text: string, rootRelative: string): ViteEdit {
  if (text.includes(PACKAGE)) {
    return { ok: true, changed: false, text };
  }
  if (!exportsConfigObject(text)) {
    return REFUSED;
  }
  const at = findListStart(text);
  if (at === -1) {
    return REFUSED;
  }
  return { ok: true, changed: true, text: addImport(insertCall(text, at, callFor(rootRelative))) };
}

/** Pure plan of what init writes and prints for one Vite app. */
export function planViteApp(input: ViteAppInput): VitePlan {
  const { dir, rootRelative, config } = input;
  const writes: ViteWrite[] = [];
  const printed: string[] = [];
  const byHand = `add ${callFor(rootRelative)} to its plugins by hand: import passback from '${PACKAGE}'`;

  if (config === undefined) {
    printed.push(`${dir}: no vite.config found; ${byHand}`);
  } else {
    const edit = addVitePlugin(config.text, rootRelative);
    if (!edit.ok) {
      printed.push(`${dir}: ${config.path} left as it is (${edit.reason}); ${byHand}`);
    } else if (edit.changed) {
      writes.push({ path: config.path, text: edit.text });
    }
  }

  printed.push(`${dir}: install it: npm i -D ${PACKAGE}`);
  printed.push(...headInstructions(dir, input.packageJson));
  return { writes, printed };
}
