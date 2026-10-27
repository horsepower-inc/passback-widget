// injects window.__passback.buildId next to the widget script.

import type { HtmlTagDescriptor } from 'vite';

export function buildIdTag(buildId: string): HtmlTagDescriptor {
  const children = `window.__passback=Object.assign(window.__passback||{},{buildId:${JSON.stringify(buildId)}});`;
  return {
    tag: 'script',
    children: children.replace(/</g, '\\u003c'),
    injectTo: 'head-prepend',
  };
}
