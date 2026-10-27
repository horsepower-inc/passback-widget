import { readShotConfig } from './shot-loader';

const GAP = 'calc(var(--pb-space-gap) * 1.5)';
const LINK = 'https://passback.dev/?ref=widget';
const LAST = '5';

const RULES = `
.pb-palette button[data-act='help'] { order: 99; font: inherit; font-weight: 600; line-height: 1; }
.pb-help { position: absolute; right: 0; bottom: calc(100% + ${GAP}); width: max-content; max-width: 240px; box-sizing: border-box; padding: 12px; display: none; flex-direction: column; gap: 6px; border: thin solid var(--pb-color-border); border-radius: 8px; background: var(--pb-color-surface); color: var(--pb-color-text); box-shadow: var(--pb-shadow-box); font: inherit; font-size: 13px; line-height: 1.4; pointer-events: auto; }
.pb-help[data-open] { display: flex; }
.pb-palette[data-corner$='left'] .pb-help { right: auto; left: 0; }
.pb-palette[data-corner^='top'] .pb-help { bottom: auto; top: calc(100% + ${GAP}); }
.pb-help p { margin: 0; }
.pb-help a { color: var(--pb-color-main); }
`;

function line(doc: Document, text: string): HTMLElement {
  const p = doc.createElement('p');
  p.textContent = text;
  return p;
}

function fill(pop: HTMLElement, bar: HTMLElement): void {
  const doc = bar.ownerDocument;
  const lines = [
    line(doc, 'Mark anything on this page; your team gets it as a task.'),
    line(doc, 'Click to mark. Esc to leave. Enter sends.'),
  ];
  const host = (bar.getRootNode() as ShadowRoot).host;
  if (readShotConfig(doc).enabled && host?.getAttribute('data-pb-pictures') !== 'off') {
    lines.push(line(doc, 'A screenshot of this tab is attached.'));
  }
  const link = doc.createElement('a');
  link.href = LINK;
  link.target = '_blank';
  link.rel = 'noopener';
  link.textContent = 'Powered by passback.dev';
  const credit = doc.createElement('p');
  credit.append(link);
  pop.replaceChildren(...lines, credit);
}

function helpButton(doc: Document): HTMLButtonElement {
  const button = doc.createElement('button');
  button.type = 'button';
  button.textContent = '?';
  button.dataset.act = 'help';
  button.setAttribute('aria-label', 'Help');
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-haspopup', 'dialog');
  button.style.setProperty('--pb-i', LAST);
  return button;
}

/** Overlay add-on: the ? button last in the palette and the one popover it opens. Returns the disposer. */
export function mountHelp(bar: HTMLElement): () => void {
  const doc = bar.ownerDocument;
  const style = doc.createElement('style');
  style.setAttribute('data-pb-help-styles', '');
  style.textContent = RULES;
  const button = helpButton(doc);
  const pop = doc.createElement('div');
  pop.className = 'pb-help';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', 'About Passback');
  const isOpen = (): boolean => pop.hasAttribute('data-open');
  const set = (open: boolean): void => {
    if (open) fill(pop, bar);
    pop.toggleAttribute('data-open', open);
    button.setAttribute('aria-expanded', String(open));
  };
  const onClick = (): void => set(!isOpen());
  const win: EventTarget = doc.defaultView ?? doc;
  const onKey = (event: Event): void => {
    if ((event as KeyboardEvent).key !== 'Escape' || !isOpen()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    set(false);
  };
  const onOutside = (event: Event): void => {
    if (!isOpen()) return;
    const path = event.composedPath();
    if (!path.includes(pop) && !path.includes(button)) set(false);
  };
  const watch = new MutationObserver(() => {
    if (!bar.hasAttribute('data-open')) set(false);
  });
  watch.observe(bar, { attributes: true, attributeFilter: ['data-open'] });
  button.addEventListener('click', onClick);
  win.addEventListener('keydown', onKey, true);
  win.addEventListener('click', onOutside, true);
  bar.append(style, button, pop);
  return () => {
    watch.disconnect();
    win.removeEventListener('keydown', onKey, true);
    win.removeEventListener('click', onOutside, true);
    style.remove();
    pop.remove();
    button.remove();
  };
}
