// a Vite-transformed module that hands import.meta.hot to the widget.

import type { HtmlTagDescriptor } from 'vite';

export const HOT_BRIDGE_URL = '/@passback/hot.js';

const HOT_BRIDGE_ID = '\0passback-hot';
const HOT_BRIDGE_SOURCE =
  "window.__passback = Object.assign(window.__passback || {}, { hot: import.meta.hot, caps: ['reopen', 'list', 'verdict', 'clear'] });";

export function hotBridgeSrc(base: string): string {
  return `${base}@passback/hot.js`;
}

export function hotBridgeTag(src: string): HtmlTagDescriptor {
  return { tag: 'script', attrs: { type: 'module', src }, injectTo: 'head-prepend' };
}

export function resolveHotBridge(id: string): string | undefined {
  return id === HOT_BRIDGE_URL ? HOT_BRIDGE_ID : undefined;
}

export function loadHotBridge(id: string): string | undefined {
  return id === HOT_BRIDGE_ID ? HOT_BRIDGE_SOURCE : undefined;
}
