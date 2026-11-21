import { CODEX_CONFIG_PATH } from './codex-files';
import { CURSOR_MCP_PATH } from './cursor-files';
import type { InitWrite } from './init-apply';
import type { NextAppInput } from './next-files';
import type { ViteAppInput } from './vite-files';

const NEXT_URL = 'http://localhost:3000';

type Token = { kind: 'word' | 'num' | 'str' | 'punct'; text: string };

const END: Token = { kind: 'punct', text: '' };
const at = (tokens: Token[], i: number): Token => tokens[i] ?? END;
const isPunct = (t: Token, text: string): boolean => t.kind === 'punct' && t.text === text;

/** Index of the closing quote of the string opening at `i`, or -1 when it is unterminated. */
function stringEnd(source: string, i: number): number {
  const quote = source[i];
  let j = i + 1;
  while (j < source.length && source[j] !== quote && (quote === '`' || source[j] !== '\n')) {
    j += source[j] === '\\' ? 2 : 1;
  }
  return source[j] === quote ? j : -1;
}

/** Index after the comment starting at `i`, -1 when unterminated, or `i` when there is no comment. */
function commentEnd(source: string, i: number): number {
  if (source.startsWith('//', i)) {
    const end = source.indexOf('\n', i);
    return end === -1 ? source.length : end;
  }
  if (source.startsWith('/*', i)) {
    const end = source.indexOf('*/', i + 2);
    return end === -1 ? -1 : end + 2;
  }
  return i;
}

/** The word, number or punctuation token at `i`. */
function plainToken(source: string, i: number): Token {
  const rest = source.slice(i);
  const word = /^[A-Za-z_$][\w$]*/.exec(rest)?.[0];
  if (word !== undefined) return { kind: 'word', text: word };
  const num = /^[0-9][\w.]*/.exec(rest)?.[0];
  if (num !== undefined) return { kind: 'num', text: num };
  return { kind: 'punct', text: rest.startsWith('...') ? '...' : rest.slice(0, 1) };
}

/** Splits JS/TS text into tokens without executing it; comments are dropped, null when one is unterminated. */
function tokenize(source: string): Token[] | null {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source.charAt(i);
    const afterComment = commentEnd(source, i);
    if (afterComment === -1) return null;
    if (afterComment !== i) {
      i = afterComment;
    } else if (/\s/.test(ch)) {
      i++;
    } else if (ch === '"' || ch === "'" || ch === '`') {
      const end = stringEnd(source, i);
      if (end === -1) return null;
      tokens.push({ kind: 'str', text: source.slice(i + 1, end) });
      i = end + 1;
    } else {
      const token = plainToken(source, i);
      tokens.push(token);
      i += token.text.length;
    }
  }
  return tokens;
}

/** Index of the `,` or closing bracket that ends the value starting at `from`. */
function skipValue(tokens: Token[], from: number): number {
  let depth = 0;
  for (let i = from; i < tokens.length; i++) {
    const t = at(tokens, i);
    if (t.kind !== 'punct') continue;
    if ('({['.includes(t.text)) depth++;
    else if (')}]'.includes(t.text)) {
      if (depth === 0) return i;
      depth--;
    } else if (t.text === ',' && depth === 0) return i;
  }
  return tokens.length;
}

/** Index of the bracket that closes the one opening at `open`, or tokens.length when unbalanced. */
function closing(tokens: Token[], open: number): number {
  let depth = 0;
  for (let i = open; i < tokens.length; i++) {
    const t = at(tokens, i);
    if (t.kind === 'punct' && '({['.includes(t.text)) depth++;
    else if (t.kind === 'punct' && ')}]'.includes(t.text) && --depth === 0) return i;
  }
  return tokens.length;
}

type Span = { start: number; end: number };

/** The value span of `name` in the object opening at `open`; undefined when absent, null when not plain or duplicate. */
function findProperty(tokens: Token[], open: number, name: string): Span | null | undefined {
  let found: Span | undefined;
  let i = open + 1;
  while (i < tokens.length && !isPunct(at(tokens, i), '}')) {
    const key = at(tokens, i);
    if (key.kind === 'punct') return null;
    if (key.text === name && key.kind !== 'num') {
      if (key.kind !== 'word' || !isPunct(at(tokens, i + 1), ':') || found) return null;
      found = { start: i + 2, end: skipValue(tokens, i + 2) };
    }
    const end = skipValue(tokens, i + 1);
    i = isPunct(at(tokens, end), ',') ? end + 1 : end;
  }
  return i < tokens.length ? found : null;
}

/** True when the token at `i` ends the export statement: `;` or end of file. */
const endsStatement = (tokens: Token[], i: number): boolean =>
  i === tokens.length || isPunct(at(tokens, i), ';');

/** The index of the `{` that opens the exported config object, or -1 for any other config shape or a larger expression. */
function configObject(tokens: Token[]): number {
  const exports: number[] = [];
  tokens.forEach((t, i) => {
    if (t.kind === 'word' && t.text === 'export' && at(tokens, i + 1).text === 'default') {
      exports.push(i + 2);
    }
  });
  const [start] = exports;
  if (exports.length !== 1 || start === undefined) return -1;
  if (isPunct(at(tokens, start), '{')) {
    return endsStatement(tokens, closing(tokens, start) + 1) ? start : -1;
  }
  return defineConfigObject(tokens, start);
}

/** The `{` of `defineConfig({ ... })` (one optional trailing comma) starting at `start`, or -1. */
function defineConfigObject(tokens: Token[], start: number): number {
  const wrapped = at(tokens, start).text === 'defineConfig' && isPunct(at(tokens, start + 1), '(');
  if (!wrapped || !isPunct(at(tokens, start + 2), '{')) return -1;
  const close = closing(tokens, start + 2);
  const paren = isPunct(at(tokens, close + 1), ',') ? close + 2 : close + 1;
  return isPunct(at(tokens, paren), ')') && endsStatement(tokens, paren + 1) ? start + 2 : -1;
}

/** The literal `server.port` of a Vite config text, or undefined when it is anything but a plain decimal. */
export function viteServerPort(configText: string | undefined): number | undefined {
  const tokens = configText === undefined ? null : tokenize(configText);
  const open = tokens === null ? -1 : configObject(tokens);
  if (tokens === null || open === -1) return undefined;
  const server = findProperty(tokens, open, 'server');
  if (!server || !isPunct(at(tokens, server.start), '{')) return undefined;
  if (closing(tokens, server.start) !== server.end - 1) return undefined;
  const port = findProperty(tokens, server.start, 'port');
  if (!port || port.end !== port.start + 1) return undefined;
  const value = at(tokens, port.start);
  if (value.kind !== 'num' || !/^[1-9]\d*$/.test(value.text)) return undefined;
  const n = Number(value.text);
  return n <= 65535 ? n : undefined;
}

/** The app URL for the agent's MCP server: only for exactly one detected Next or Vite app. */
export function inferMcpUrl(apps: {
  appCount: number;
  nextApps: NextAppInput[];
  viteApps: ViteAppInput[];
}): string | undefined {
  if (apps.appCount > 1 || apps.nextApps.length + apps.viteApps.length !== 1) return undefined;
  if (apps.nextApps.length === 1) return NEXT_URL;
  const port = viteServerPort(apps.viteApps[0]?.config?.text);
  return port === undefined ? undefined : `http://localhost:${port}`;
}

function withJsonEnv(text: string, url: string): string {
  const parsed = JSON.parse(text) as { mcpServers: { passback: Record<string, unknown> } };
  parsed.mcpServers.passback.env = { PASSBACK_URL: url };
  return JSON.stringify(parsed, null, 2) + '\n';
}

/** The writes with PASSBACK_URL added to each newly generated Passback MCP entry; existing entries produce no write. */
export function withMcpUrl(writes: InitWrite[], url: string | undefined): InitWrite[] {
  if (url === undefined) return writes;
  return writes.map((w) => {
    if (w.path === '.mcp.json' || w.path === CURSOR_MCP_PATH) {
      return { path: w.path, text: withJsonEnv(w.text, url) };
    }
    if (w.path === CODEX_CONFIG_PATH) {
      return {
        path: w.path,
        text: `${w.text}\n[mcp_servers.passback.env]\nPASSBACK_URL = ${JSON.stringify(url)}\n`,
      };
    }
    return w;
  });
}
