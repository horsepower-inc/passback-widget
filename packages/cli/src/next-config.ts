export type WrapResult =
  | { ok: true; changed: boolean; text: string }
  | { ok: false; reason: string };

const REFUSED: WrapResult = { ok: false, reason: 'unrecognised next.config shape' };
const ESM_IMPORT = "import { withPassback } from '@passback/next';";
const CJS_IMPORT = "const { withPassback } = require('@passback/next');";
const ID = '[A-Za-z_$][\\w$]*';
const RESERVED = new Set(['function', 'class', 'async', 'await', 'new']);

interface Shape {
  esm: boolean;
  text: string;
}

function isId(name: string | undefined): name is string {
  return name !== undefined && !RESERVED.has(name);
}

function objectRunsToEnd(body: string): boolean {
  const end = body.search(/\}\s*;?\s*$/);
  if (!body.startsWith('{') || end === -1) return false;
  let depth = 0;
  for (let i = 0; i <= end; i++) {
    if (body[i] === '{') depth++;
    else if (body[i] === '}') depth--;
    if (depth === 0) return i === end;
  }
  return false;
}

/** Rewrites the last top-level export statement, or returns undefined when it is not a recognised shape. */
function matchShape(text: string, root: string): Shape | undefined {
  const starts = [...text.matchAll(/^(export\s+default|module\.exports\s*=)(?=\s)/gm)];
  const last = starts[starts.length - 1];
  if (last === undefined) return undefined;
  const esm = last[0].startsWith('export');
  const head = esm ? 'export default' : 'module.exports =';
  const rest = text.slice(last.index + last[0].length).trim();
  const options = `{ root: '${root}' }`;
  const call = rest.match(new RegExp(`^(?:(${ID})\\s*\\(\\s*(${ID})\\s*\\)|(${ID}))\\s*;?$`));
  let wrapped: string | undefined;
  if (call !== null) {
    const [, fn, arg, bare] = call;
    if (isId(bare)) wrapped = `withPassback(${bare}, ${options})`;
    else if (isId(fn) && isId(arg)) wrapped = `${fn}(withPassback(${arg}, ${options}))`;
  } else if (objectRunsToEnd(rest)) {
    wrapped = `withPassback(${rest.replace(/\s*;?\s*$/, '')}, ${options})`;
  }
  if (wrapped === undefined) return undefined;
  return { esm, text: `${text.slice(0, last.index)}${head} ${wrapped};\n` };
}

function withImport(text: string, esm: boolean): string {
  const lines = text.split('\n');
  const isHeader = esm
    ? (line: string): boolean => /^import .*['"];?$/.test(line)
    : (line: string): boolean => line.startsWith('const ') && line.includes('require(');
  let at = 0;
  lines.forEach((line, i) => {
    if (isHeader(line)) at = i + 1;
  });
  lines.splice(at, 0, esm ? ESM_IMPORT : CJS_IMPORT);
  return lines.join('\n');
}

/** Pure text edit: wraps a recognised next.config export in withPassback and adds the import. */
export function wrapNextConfig(text: string, root: string): WrapResult {
  if (text.includes('withPassback')) return { ok: true, changed: false, text };
  const shape = matchShape(text, root);
  if (shape === undefined) return REFUSED;
  return { ok: true, changed: true, text: withImport(shape.text, shape.esm) };
}
