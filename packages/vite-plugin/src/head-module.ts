// The dev-server half of `@passback/vite-plugin/head`: resolves the public import to a virtual
// module that carries the current tags, and converts them to the public shape and to HTML.

import type { HtmlTagDescriptor, IndexHtmlTransformContext, UserConfig } from 'vite';
import type { PassbackHeadTag } from './head';

const HEAD_PACKAGE = '@passback/vite-plugin';
export const HEAD_IMPORT = `${HEAD_PACKAGE}/head`;

const HEAD_ID = '\0passback-head';

// SSR externalizes an installed dependency before any resolveId hook runs, which would load the
// inert dist/head.js; Vite matches noExternal by package name, so the package stays in the graph.
// The app's own value is kept: `true` already covers it, anything else gains the package name.
export function keepHeadInSsr(config: UserConfig): void {
  const current = config.ssr?.noExternal;
  if (current === true) return;
  const list = current === undefined ? [] : Array.isArray(current) ? current : [current];
  if (list.includes(HEAD_PACKAGE)) return;
  config.ssr = { ...config.ssr, noExternal: [...list, HEAD_PACKAGE] };
}

export function resolveHead(id: string): string | undefined {
  return id === HEAD_IMPORT ? HEAD_ID : undefined;
}

export function loadHead(
  id: string,
  indexTags: (ctx: IndexHtmlTransformContext) => HtmlTagDescriptor[],
): string | undefined {
  if (id !== HEAD_ID) return undefined;
  return headModuleSource(toHeadTags(indexTags({ path: '/' } as IndexHtmlTransformContext)));
}

export function toHeadTags(descriptors: HtmlTagDescriptor[]): PassbackHeadTag[] {
  return descriptors.map((descriptor) => {
    const attrs: Record<string, string> = {};
    const own = typeof descriptor.attrs === 'object' ? descriptor.attrs : {};
    for (const [name, value] of Object.entries(own)) {
      if (typeof value === 'boolean' || value === undefined) continue;
      attrs[name] = String(value);
    }
    const tag: PassbackHeadTag = { tag: descriptor.tag as PassbackHeadTag['tag'], attrs };
    if (typeof descriptor.children === 'string') tag.children = descriptor.children;
    return tag;
  });
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function headTagsHtml(tags: PassbackHeadTag[]): string {
  return tags
    .map(({ tag, attrs, children }) => {
      const list = Object.entries(attrs).map(([name, value]) => ` ${name}="${escapeAttr(value)}"`);
      const open = `<${tag}${list.join('')}>`;
      if (tag === 'meta') return open;
      const body = children === undefined ? '' : tag === 'script' ? children : escapeText(children);
      return `${open}${body}</${tag}>`;
    })
    .join('');
}

export function headModuleSource(tags: PassbackHeadTag[]): string {
  const json = JSON.stringify(tags).replace(/</g, '\\u003c');
  return [
    `const tags = ${json};`,
    'export function passbackHead() { return tags.map((tag) => ({ ...tag, attrs: { ...tag.attrs } })); }',
    `const html = ${JSON.stringify(headTagsHtml(tags)).replace(/</g, '\\u003c')};`,
    'export function passbackHeadHtml() { return html; }',
    '',
  ].join('\n');
}
