export const HOST_ATTRIBUTE = 'data-passback-host';

export type Mounted = {
  host: HTMLElement;
  root: ShadowRoot;
  unmount(): void;
};

function unmount(host: HTMLElement): void {
  host.parentNode?.removeChild(host);
}

export function mount(doc: Document = globalThis.document): Mounted {
  const existing = doc.querySelector<HTMLElement>(`[${HOST_ATTRIBUTE}]`);
  if (existing?.shadowRoot) {
    return { host: existing, root: existing.shadowRoot, unmount: () => unmount(existing) };
  }

  const host = doc.createElement('div');
  host.setAttribute(HOST_ATTRIBUTE, '');
  const root = host.attachShadow({ mode: 'open' });
  (doc.body ?? doc.documentElement).appendChild(host);

  return { host, root, unmount: () => unmount(host) };
}
