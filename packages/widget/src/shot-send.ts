import { createBubble, type Bubble } from './bubble-view';
import { celebrate } from './fx';
import { dispatch, type FlowCtx } from './overlay-draw';
import { drawingEligible, resetSubmission, submitDrawing, type SubmitCtx } from './overlay-submit';
import { PHASE_ATTRIBUTE } from './phase';

export type DrawingSendOptions = {
  win: Window;
  root: ShadowRoot;
  parent(): HTMLElement | undefined;
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

const PLANE = 'M2.5 8h10M8.5 3.5L13 8l-4.5 4.5';

function makeButton(parent: HTMLElement): HTMLButtonElement {
  const doc = parent.ownerDocument;
  const button = doc.createElement('button');
  button.type = 'button';
  button.title = 'Send all';
  button.setAttribute('aria-label', 'Send');
  button.setAttribute('aria-labelledby', 'pb-send-all');
  button.style.cssText =
    'width:auto;padding:0 var(--pb-space-pad);gap:var(--pb-space-gap);grid-auto-flow:column;border-radius:var(--pb-radius-control);font:var(--pb-font-body);white-space:nowrap';
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
  button.append(svg, text);
  return button;
}

export function mountDrawingSend(opts: DrawingSendOptions): DrawingSend {
  let bound: SubmitCtx | undefined;
  let button: HTMLButtonElement | undefined;
  let owner: Bubble | undefined;
  let watch: MutationObserver | undefined;
  let gone = false;

  const hide = (): void => {
    button?.removeEventListener('click', activate);
    button?.remove();
    button = undefined;
  };

  function sync(): void {
    const parent = opts.parent();
    if (gone || !bound || !parent || !drawingEligible(bound)) return hide();
    if (!button) {
      button = makeButton(parent);
      button.addEventListener('click', activate);
    }
    if (button.parentElement !== parent) parent.append(button);
    button.disabled = opts.count() === 0;
  }

  // Eligibility is read again here: a click never submits on the strength of the last paint.
  function activate(): void {
    const ctx = bound;
    const drawings = opts.count();
    if (gone || !ctx || !button || drawings === 0 || !drawingEligible(ctx, drawings)) return sync();
    const rect = button.getBoundingClientRect();
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
    const rect = ctx.launcher.element.getBoundingClientRect();
    const at = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    celebrate(opts.root, ctx.launcher.element, 'sent', at);
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
