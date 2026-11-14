import { loadPanelOpen, type InboxPanelSession } from './panel-loader';
import type { MarkRow } from './tray-view';

export type InboxToolCtx = {
  root: ShadowRoot;
  host: HTMLElement;
  rows: { rows(): readonly MarkRow[] };
};

type Scope = { __passback?: Record<string, unknown> };

const NS = 'http://www.w3.org/2000/svg';
const LIST_PATH = 'M6 4h7.5M6 8h7.5M6 12h7.5M2.5 4h.01M2.5 8h.01M2.5 12h.01';
const RULES = `
.pb-palette-divider { order: 89; width: 1px; height: 20px; background: var(--pb-color-border); }
.pb-palette button[data-act='inbox'] { order: 90; }
`;

/** The panel chunk URL a local widget script names; empty on a hosted page. */
function panelSource(doc: Document): string {
  const script = doc.querySelector('script[data-passback-panel]');
  return script?.getAttribute('data-passback-panel')?.trim() ?? '';
}

function inboxButton(doc: Document): HTMLButtonElement {
  const button = doc.createElement('button');
  button.type = 'button';
  button.title = 'Inbox';
  button.setAttribute('aria-label', 'Inbox');
  button.setAttribute('aria-pressed', 'false');
  button.dataset.act = 'inbox';
  button.style.setProperty('--pb-i', '4');
  const svg = doc.createElementNS(NS, 'svg');
  const attrs = { viewBox: '0 0 16 16', width: '16', height: '16', 'aria-hidden': 'true' };
  Object.entries(attrs).forEach(([name, value]) => svg.setAttribute(name, value));
  const path = doc.createElementNS(NS, 'path');
  path.setAttribute('d', LIST_PATH);
  svg.append(path);
  button.append(svg);
  return button;
}

/** Collector-chunk add-on: on a local page, an Inbox tool next to ? that shows and hides the panel chunk. */
export function inboxTool(ctx: InboxToolCtx): void {
  const { root, host } = ctx;
  const doc = root.ownerDocument;
  const win = doc.defaultView;
  const src = panelSource(doc);
  const bar = root.querySelector<HTMLElement>('.pb-palette');
  if (!src || !win || !bar) return;
  const style = doc.createElement('style');
  style.setAttribute('data-pb-inbox-tool-styles', '');
  style.textContent = RULES;
  const divider = doc.createElement('span');
  divider.className = 'pb-palette-divider';
  divider.setAttribute('aria-hidden', 'true');
  const button = inboxButton(doc);
  let session: InboxPanelSession | undefined;
  let loading = false;
  let ticket = 0;
  const press = (on: boolean): void => button.setAttribute('aria-pressed', String(on));
  const hide = (): void => {
    ticket += 1;
    loading = false;
    const open = session;
    session = undefined;
    open?.close();
    press(false);
  };
  const show = (): void => {
    const mine = ++ticket;
    loading = true;
    press(true);
    const fail = (): void => {
      if (mine !== ticket) return;
      loading = false;
      press(false);
    };
    loadPanelOpen(doc, win, src)
      .then((open) => {
        if (mine !== ticket) return;
        loading = false;
        session = open({
          root,
          win,
          anchor: button,
          onClose: () => {
            session = undefined;
            press(false);
          },
          onMenu: () => undefined,
        });
        if (!session) press(false);
      })
      .catch(fail);
  };
  const click = (): void => {
    if (loading) return;
    if (session) hide();
    else show();
  };
  const watch = new MutationObserver(() => {
    if (!bar.hasAttribute('data-open') && (session || loading)) hide();
  });
  const scope = win as unknown as Scope;
  const kept = (): readonly MarkRow[] => ctx.rows.rows();
  const dispose = (): void => {
    hide();
    watch.disconnect();
    button.removeEventListener('click', click);
    host.removeEventListener('passback:dispose', dispose);
    if (scope.__passback?.kept === kept) delete scope.__passback.kept;
    button.remove();
    divider.remove();
    style.remove();
  };
  scope.__passback = Object.assign(scope.__passback ?? {}, { kept });
  watch.observe(bar, { attributes: true, attributeFilter: ['data-open'] });
  button.addEventListener('click', click);
  host.addEventListener('passback:dispose', dispose);
  root.append(style);
  bar.append(divider, button);
}
