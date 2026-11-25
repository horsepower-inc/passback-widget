// Public `@passback/vite-plugin/head`: the Passback tags for a page a framework renders on the server.
// This file is the inert fallback; the dev server swaps in the real tags (head-module.ts).

export type PassbackHeadTag = {
  tag: 'script' | 'meta';
  attrs: Record<string, string>;
  children?: string;
};

export function passbackHead(): PassbackHeadTag[] {
  return [];
}

export function passbackHeadHtml(): string {
  return '';
}
