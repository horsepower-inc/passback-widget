import { mountHelp } from './help';
import { dispatch, type FlowCtx } from './overlay-draw';

type PaletteCtx = FlowCtx & { root: ShadowRoot };

const NS = 'http://www.w3.org/2000/svg';
const POINT_PATH = 'M3 2l10 5.2-4.2 1.4L7.2 13z';
const SHOWN = ['armed', 'composing', 'drawing'];
const TOOLS = 'button[data-tool], button[data-act]';
const GAP = 'calc(var(--pb-space-gap) * 1.5)';
const BESIDE = `calc(${GAP} + var(--pb-size-launcher) + var(--pb-space-gap))`;
const SLIDE = 'translateX(var(--pb-size-launcher)) scale(0.4)';
const STEP = 35;
const OPEN_DELAY = `calc(var(--pb-i, 0) * ${STEP}ms)`;
const TIME = 'var(--pb-motion-duration)';
const EASE = 'cubic-bezier(0.34, 1.56, 0.64, 1)';

const RULES = `
.pb-palette { position: fixed; right: ${BESIDE}; bottom: ${GAP}; height: var(--pb-size-launcher); display: flex; align-items: center; gap: var(--pb-space-gap); pointer-events: none; }
.pb-palette:not([data-open]) { visibility: hidden; transition: visibility 0s linear ${TIME}; }
.pb-palette[data-corner$='left'] { right: auto; left: ${BESIDE}; }
.pb-palette[data-corner^='top'] { bottom: auto; top: ${GAP}; }
.pb-palette :is(button[data-tool], button[data-act]) { width: 32px; height: 32px; padding: 0; display: grid; place-items: center; border: thin solid var(--pb-color-border); border-radius: 50%; background: var(--pb-color-surface); color: var(--pb-color-text); box-shadow: var(--pb-shadow-box); cursor: pointer; opacity: 0; visibility: hidden; transform: ${SLIDE}; pointer-events: none; transition: opacity ${TIME} var(--pb-motion-ease), transform ${TIME} var(--pb-motion-ease), visibility 0s linear ${TIME}; }
.pb-palette[data-corner$='left'] :is(button[data-tool], button[data-act]) { transform: translateX(calc(var(--pb-size-launcher) * -1)) scale(0.4); }
.pb-palette[data-open] :is(button[data-tool], button[data-act]) { opacity: var(--pb-opacity-idle, 1); visibility: visible; transform: none; pointer-events: auto; transition-property: opacity, transform, visibility; transition-delay: ${OPEN_DELAY}, ${OPEN_DELAY}, 0s; transition-timing-function: ${EASE}, ${EASE}, linear; }
.pb-palette :is(button[data-tool], button[data-act]):hover, .pb-palette :is(button[data-tool], button[data-act]):focus-visible { opacity: 1; }
.pb-palette :is(button[data-tool], button[data-act]):disabled { cursor: default; }
.pb-palette[data-open] :is(button[data-tool], button[data-act]):disabled { opacity: var(--pb-opacity-idle, 1); }
.pb-palette[data-open] :is(button[data-tool], button[data-act])[data-enter] { opacity: 0; transform: ${SLIDE}; transition: none; }
.pb-palette[data-open][data-corner$='left'] :is(button[data-tool], button[data-act])[data-enter] { transform: translateX(calc(var(--pb-size-launcher) * -1)) scale(0.4); }
.pb-palette button[aria-pressed='true'] { background: var(--pb-color-main); border-color: var(--pb-color-main); color: var(--pb-color-on-main); }
.pb-palette[data-open] button[aria-pressed='true'] { opacity: 1; }
.pb-palette svg { fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
@media (prefers-reduced-motion: reduce) { .pb-palette:not([data-open]) { transition: none; } .pb-palette :is(button[data-tool], button[data-act]) { transition: none; } }
`;

function pointButton(doc: Document): HTMLButtonElement {
  const button = doc.createElement('button');
  button.type = 'button';
  button.title = 'Point';
  button.setAttribute('aria-label', 'Point');
  button.setAttribute('aria-pressed', 'true');
  button.dataset.tool = 'point';
  button.style.setProperty('--pb-i', '0');
  const svg = doc.createElementNS(NS, 'svg');
  const attrs = { viewBox: '0 0 16 16', width: '16', height: '16', 'aria-hidden': 'true' };
  Object.entries(attrs).forEach(([name, value]) => svg.setAttribute(name, value));
  const path = doc.createElementNS(NS, 'path');
  path.setAttribute('d', POINT_PATH);
  svg.append(path);
  button.append(svg);
  return button;
}

function markPressed(bar: HTMLElement, drawing: boolean): void {
  const pending = bar.dataset.pending !== undefined;
  bar.querySelectorAll<HTMLElement>(TOOLS).forEach((button) => {
    const { tool } = button.dataset;
    if (!tool) return;
    const on =
      !(button as HTMLButtonElement).disabled &&
      (tool === 'point'
        ? !drawing && !pending
        : (drawing || pending) && tool === (bar.dataset.shape ?? 'arrow'));
    button.setAttribute('aria-pressed', String(on));
    button.setAttribute('part', `tool tool-${tool}${on ? ' tool-on' : ''}`);
  });
}

function choose(ctx: PaletteCtx, bar: HTMLElement, tool: string): void {
  const { flow } = ctx.state;
  if (tool === 'point') {
    delete bar.dataset.pending;
    if (flow === 'drawing' || flow === 'armed') dispatch(ctx, 'drawOff');
  } else if (flow === 'armed') {
    bar.dataset.shape = tool;
    bar.dataset.pending = '';
    dispatch(ctx, 'drawOn');
  } else if (flow === 'composing' || flow === 'drawing') {
    bar.dataset.shape = tool;
    if (flow === 'composing') dispatch(ctx, 'drawOn');
  }
}

/** A tool appended while the bar is open starts from the closed look, so it springs in. */
function enterAppended(bar: HTMLElement, records: MutationRecord[]): void {
  if (!bar.hasAttribute('data-open')) return;
  records
    .flatMap((record) => [...record.addedNodes])
    .filter((node): node is HTMLElement => node instanceof HTMLElement && node.matches(TOOLS))
    .forEach((button) => {
      button.setAttribute('data-enter', '');
      void button.offsetWidth;
      button.removeAttribute('data-enter');
    });
}

/** Collector-chunk add-on: the Point tool of the palette, shown beside the ball while the widget is live; the shot chunk adds the shape tools. */
export function palette(ctx: PaletteCtx): void {
  const { root, host, state } = ctx;
  const doc = root.ownerDocument;
  const style = doc.createElement('style');
  style.setAttribute('data-pb-palette-styles', '');
  style.textContent = RULES;
  const bar = doc.createElement('div');
  bar.className = 'pb-palette';
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Drawing tools');
  bar.dataset.role = 'tools';
  bar.dataset.corner =
    root.querySelector('.pb-launcher')?.getAttribute('data-corner') ?? 'bottom-right';
  const unmountHelp = (bar.append(pointButton(doc)), mountHelp(bar));
  root.append(style, bar);
  const sync = (): void => {
    if (state.flow === 'idle') delete bar.dataset.pending;
    if (state.flow === 'composing' && bar.dataset.pending !== undefined) {
      delete bar.dataset.pending;
      dispatch(ctx, 'drawOn');
    }
    const open = host.getAttribute('data-pb-panel') === 'open' && SHOWN.includes(state.flow);
    const drawing = state.flow === 'drawing';
    bar.toggleAttribute('data-open', open);
    bar.toggleAttribute('data-on', state.flow === 'composing' || drawing);
    markPressed(bar, drawing);
    if (open) host.dispatchEvent(new Event('passback:preload'));
  };
  const click = (event: Event): void => {
    const tool = (event.target as Element).closest<HTMLElement>('button[data-tool]')?.dataset.tool;
    if (tool === undefined) return;
    choose(ctx, bar, tool);
    sync();
  };
  const watch = new MutationObserver((records) => (enterAppended(bar, records), sync()));
  watch.observe(bar, { childList: true });
  bar.addEventListener('click', click);
  const dispose = (): void => {
    host.removeEventListener('passback:sync', sync);
    host.removeEventListener('passback:dispose', dispose);
    watch.disconnect();
    unmountHelp();
    style.remove();
    bar.remove();
  };
  host.addEventListener('passback:sync', sync);
  host.addEventListener('passback:dispose', dispose);
  void bar.offsetWidth; // flush the closed style so the first open transitions
  sync();
}
