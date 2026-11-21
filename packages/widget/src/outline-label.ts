import { labelOf } from './outline-label-text';
import type { FlowCtx } from './overlay-draw';

type LabelCtx = FlowCtx & { root: ShadowRoot };

const RULES = `
.pb-outline-label { position: fixed; z-index: 2147483647; max-width: min(40ch, 90vw); box-sizing: border-box; padding: 1px var(--pb-space-gap); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font: 11px/1.4 var(--pb-font, system-ui, sans-serif); background: var(--pb-color-main); color: var(--pb-color-on-main); border-radius: var(--pb-radius, 3px); pointer-events: none; }
.pb-outline-label[hidden] { display: none; }
`;
const HEIGHT = 20;

function paint(label: HTMLElement, hovered: Element | null, flow: string): void {
  if (hovered === null || flow !== 'armed') {
    label.hidden = true;
    return;
  }
  try {
    label.textContent = labelOf(hovered);
  } catch {
    label.textContent = hovered.tagName.toLowerCase();
  }
  const rect = hovered.getBoundingClientRect();
  const above = rect.top >= HEIGHT;
  label.style.left = `${Math.max(0, rect.left)}px`;
  label.style.top = `${above ? rect.top - HEIGHT : rect.bottom}px`;
  label.dataset.side = above ? 'above' : 'below';
  label.hidden = false;
}

/** Collector-chunk add-on: names the hovered element on its outline while the flow is armed. */
export function outlineLabel(ctx: LabelCtx): void {
  const { root, host, state } = ctx;
  const doc = root.ownerDocument;
  const style = doc.createElement('style');
  style.setAttribute('data-pb-outline-label-styles', '');
  style.textContent = RULES;
  const label = doc.createElement('div');
  label.className = 'pb-outline-label';
  label.setAttribute('part', 'outline-label');
  label.hidden = true;
  root.append(style, label);
  let hovered: Element | null = null;

  const place = (): void => paint(label, hovered, state.flow);
  const hover = (event: Event): void => {
    const { detail } = event as CustomEvent<Element | null>;
    hovered = detail ?? null;
    place();
  };
  const sync = (): void => {
    if (state.flow !== 'armed') {
      hovered = null;
      label.hidden = true;
    }
  };
  const dispose = (): void => {
    for (const [name, fn] of events) host.removeEventListener(name, fn);
    style.remove();
    label.remove();
  };
  const events: [string, EventListener][] = [
    ['passback:hover', hover],
    ['passback:sync', sync],
    ['passback:dispose', dispose],
  ];
  for (const [name, fn] of events) host.addEventListener(name, fn);
}
