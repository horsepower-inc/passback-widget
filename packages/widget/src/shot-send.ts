import { createBubble, type Bubble } from './bubble-view';
import { celebrate } from './fx';
import { dispatch, type FlowCtx } from './overlay-draw';
import { drawingEligible, resetSubmission, submitDrawing, type SubmitCtx } from './overlay-submit';
import { PHASE_ATTRIBUTE } from './phase';
import { CLASS } from './styles';

export type DrawingSendOptions = {
  win: Window;
  root: ShadowRoot;
  active(): boolean;
  count(): number;
};
export type DrawingSend = { bind(ctx: FlowCtx): void; sync(): void; destroy(): void };

export const drawingComment = (pathname: string): string => `Drawing on ${pathname}`;

// An acknowledged drawing owner outlives its shot; arming again means the person has moved on from it.
function dropAcknowledged({ state }: SubmitCtx): void {
  if (state.flow !== 'armed' || state.submitting || !state.drawingDetail || !state.bubble) return;
  state.bubble.destroy();
  Object.assign(state, { bubble: null, drawingDetail: null });
  resetSubmission(state);
}

const INTERACTIVE = 'a,button,summary,select,input,textarea,[contenteditable],[role="textbox"]';

// Enter belongs to whatever the person is typing in or pressing; only the page itself falls through to Send.
function reserved(event: KeyboardEvent): boolean {
  const target = event.composedPath()[0];
  return (
    event.defaultPrevented ||
    event.isComposing ||
    event.repeat ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    (target instanceof Element &&
      (target.closest(INTERACTIVE) !== null || (target as HTMLElement).isContentEditable))
  );
}

const PLANE = 'M2.5 8h10M8.5 3.5L13 8l-4.5 4.5';

function makeButton(doc: Document): HTMLButtonElement {
  const button = doc.createElement('button');
  button.type = 'button';
  button.title = 'Send all';
  button.setAttribute('aria-label', 'Send');
  button.setAttribute('aria-labelledby', 'pb-send-all');
  button.style.cssText =
    'width:auto;padding:0 var(--pb-space-pad);gap:var(--pb-space-gap);grid-auto-flow:column;font:var(--pb-font-body);white-space:nowrap';
  button.dataset.act = 'send';
  button.setAttribute('part', 'tool tool-send');
  const ns = 'http://www.w3.org/2000/svg';
  const svg = doc.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.cssText =
    'fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round';
  const path = doc.createElementNS(ns, 'path');
  path.setAttribute('d', PLANE);
  svg.append(path);
  const text = doc.createElement('span');
  text.id = 'pb-send-all';
  text.textContent = button.title;
  const count = doc.createElement('span');
  count.dataset.count = '';
  button.append(svg, text, count);
  return button;
}

// The pill shows the number of drawings beside its label, and not at all with none.
function paintCount(button: HTMLButtonElement, drawings: number): void {
  button.disabled = button.hidden = drawings === 0;
  button.querySelector('[data-count]')!.textContent = drawings === 0 ? '' : String(drawings);
}

type HintBar = { element: HTMLElement; remove(): void };

// The drawing hint; the armed Point hint is kept out of sight beside it and comes back with it gone.
function mountHintBar(
  root: ShadowRoot,
  win: Window,
  onKey: (event: KeyboardEvent) => void,
): HintBar {
  const doc = root.ownerDocument;
  const element = doc.createElement('div');
  element.className = CLASS.hint;
  element.dataset.draw = '';
  element.setAttribute('part', 'hint');
  element.setAttribute(
    'data-corner',
    root.querySelector('.pb-launcher')?.getAttribute('data-corner') ?? 'bottom-right',
  );
  const text = doc.createElement('span');
  text.setAttribute('role', 'status');
  text.append('Esc to leave · Enter to send');
  element.append(text);
  root.append(element);
  let strays: HTMLElement[] = [];
  const hideStrays = (): void => {
    root.querySelectorAll<HTMLElement>(`.${CLASS.hint}:not([data-draw])`).forEach((hint) => {
      if (hint.hidden) return;
      hint.hidden = true;
      strays.push(hint);
    });
  };
  hideStrays();
  const watch = new MutationObserver(hideStrays);
  watch.observe(root, { childList: true });
  win.addEventListener('keydown', onKey, true);
  return {
    element,
    remove() {
      win.removeEventListener('keydown', onKey, true);
      watch.disconnect();
      element.remove();
      strays.forEach((hint) => (hint.hidden = false));
      strays = [];
    },
  };
}

function celebrateAtBall(root: ShadowRoot, ctx: SubmitCtx): void {
  const rect = ctx.launcher.element.getBoundingClientRect();
  const at = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  celebrate(root, ctx.launcher.element, 'sent', at);
}

function openOwner(opts: DrawingSendOptions, ctx: SubmitCtx, rect: DOMRect) {
  const bubble = createBubble(opts.root, {
    anchor: { x: rect.left, y: rect.top },
    onSend: () => undefined,
    onCancel: ctx.guard(() => void dispatch(ctx, 'cancel')),
  });
  const detail = {
    comment: drawingComment(opts.win.location.pathname),
    selector: 'body',
    offset: { x: 0, y: 0 },
    element: ctx.host.ownerDocument.body,
    marks: [],
  };
  return { bubble, detail };
}

export function mountDrawingSend(opts: DrawingSendOptions): DrawingSend {
  let bound: SubmitCtx | undefined;
  let button: HTMLButtonElement | undefined;
  let bar: HintBar | undefined;
  let owner: Bubble | undefined;
  let watch: MutationObserver | undefined;
  let gone = false;

  const dropButton = (): void => {
    button?.removeEventListener('click', activate);
    button?.remove();
    button = undefined;
  };

  const hide = (): void => {
    dropButton();
    bar?.remove();
    bar = undefined;
  };

  function sync(): void {
    if (gone || !bound || !opts.active() || bound.state.flow !== 'armed') return hide();
    const parent = (bar ??= mountHintBar(opts.root, opts.win, onKey)).element;
    if (!drawingEligible(bound)) return dropButton();
    if (!button) {
      button = makeButton(opts.root.ownerDocument);
      button.addEventListener('click', activate);
    }
    if (button.parentElement !== parent) parent.append(button);
    paintCount(button, opts.count());
  }

  function onKey(event: KeyboardEvent): void {
    if (event.key !== 'Enter' || !button || button.disabled || reserved(event)) return;
    event.preventDefault();
    activate();
  }

  // Eligibility is read again here: a click never submits on the strength of the last paint.
  function activate(): void {
    const ctx = bound;
    const drawings = opts.count();
    if (gone || !ctx || !button || drawings === 0 || !drawingEligible(ctx, drawings)) return sync();
    const { bubble, detail } = openOwner(opts, ctx, button.getBoundingClientRect());
    owner = bubble;
    // The overlay reports an acknowledgement through these; a drawing answers with the celebration alone.
    bubble.showAcked = bubble.showSent = () => acknowledge(bubble);
    bubble.showNote = () => undefined;
    if (!submitDrawing(ctx, detail, bubble, drawings)) {
      bubble.destroy();
      owner = undefined;
    }
    sync();
  }

  // Runs from the overlay's acknowledgement, so the shot being closed by now does not matter.
  function acknowledge(bubble: Bubble): void {
    const ctx = bound;
    if (!ctx || ctx.state.bubble !== bubble) return;
    ctx.state.submitting = false;
    bubble.element.hidden = true;
    celebrateAtBall(opts.root, ctx);
    ctx.leaveArmed();
  }

  // The overlay lets go of an accepted owner by replacing its bubble or hiding.
  const release = (): void => {
    const state = bound?.state;
    if (!owner || (state?.bubble === owner && state.flow !== 'hidden')) return;
    watch?.disconnect();
    owner.destroy();
    owner = watch = undefined;
  };

  return {
    bind(ctx) {
      bound = ctx as SubmitCtx;
      dropAcknowledged(bound);
      release();
      sync();
    },
    sync,
    destroy() {
      gone = true;
      hide();
      const state = bound?.state;
      // Not yet handed to onSubmit: withdraw it, so a late readiness outcome is dropped.
      if (owner && state?.bubble === owner && state.pendingDetail === null) {
        Object.assign(state, { bubble: null, drawingDetail: null });
        resetSubmission(state);
      }
      release();
      // A handed-off owner stays for its ack or error; every dispatch rewrites the host's phase, so check then.
      if (!owner || !bound) return;
      (watch = new MutationObserver(release)).observe(bound.host, {
        attributeFilter: [PHASE_ATTRIBUTE],
      });
    },
  };
}
