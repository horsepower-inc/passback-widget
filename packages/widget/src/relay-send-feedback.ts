import type { Bubble } from './bubble-view';
import { celebrate } from './fx';
import type { Dot } from './dot-view';
import type { Launcher } from './launcher';
import { CLASS } from './styles';

// A relay send leaves the mark's own dot and bubble at once; the ball carries sending, Sent and errors.
// Presentation only: the owners and the retry callback come from the caller, nothing of the submission is kept.
export type RelayOwner = { dot: Dot | null; bubble: Bubble };

export type RelaySendFeedback = {
  /** Hides the owner's dot and bubble, and shows sending at the ball. Safe to call again on a retry. */
  sending(owner: RelayOwner, rest?: readonly RelayOwner[]): void;
  /** True while this bubble was handed in as part of a batch sending and has no tray row. */
  submitted(bubble: Bubble | null): boolean;
  /** True while the ball is showing sending or an error for this bubble. */
  owns(bubble: Bubble | null): boolean;
  /** True while any relay send needs the ball: sending, or an error waiting for Retry. */
  active(): boolean;
  /** Stops sending and celebrates once at the ball. False when this bubble is not owned. */
  sent(owner: RelayOwner): boolean;
  /** Stops sending and shows the bubble's error and Retry beside the ball. False when not owned. */
  error(bubble: Bubble | null, message: string, onRetry: () => void): boolean;
  /** Gives an owner its own presentation back, for a send that turned out not to be a relay one. */
  release(bubble: Bubble | null): void;
  dispose(): void;
};

type FeedbackCtx = { root: ShadowRoot; launcher: Launcher };

/** On the launcher while a relay send is in flight; the panel keeps the ball visible while it is set. */
export const RELAY_SENDING = 'data-pb-relay-sending';
const GONE = 'data-pb-relay-gone';
const ERROR = 'data-pb-relay-error';
const STYLE = 'data-pb-relay-styles';
const STATUS = 'pb-relay-status';

function rules(): string {
  const ball = `.${CLASS.launcher}[${RELAY_SENDING}]`;
  // The Capture screen fallback lives in the sending bubble and must stay reachable.
  const away = `.${CLASS.bubble}[${GONE}]:not(:has([data-role="capture-screen"]))`;
  return `.${CLASS.dot}[${GONE}], ${away} { display: none !important; }
/* corner-pins hides a bubble inline when its target scrolls away; Capture screen stays visible. */
.${CLASS.bubble}[${GONE}]:has([data-role="capture-screen"]) { visibility: visible !important; }
/* The error beside the ball stays visible when its pin scrolls out of view. */
.${CLASS.bubble}[${ERROR}] { visibility: visible !important; }
/* data-docked only keeps corner-pins away; moveTo's left and top place the error, not the docked strip. */
.${CLASS.bubble}[${ERROR}][data-docked] { position: absolute; right: auto; bottom: auto; width: var(--pb-size-box); max-width: none; }
${ball}::after { content: ""; position: absolute; inset: -4px; border-radius: 50%; border: 2.5px solid transparent; border-top-color: var(--pb-color-accent); border-right-color: var(--pb-color-accent); animation: pb-relay-spin var(--pb-motion-spin) linear infinite; pointer-events: none; }
@keyframes pb-relay-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { ${ball}::after { animation: none; border-color: var(--pb-color-accent); } }
.${STATUS} { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }`;
}

// The bubble opens beside this point: out from the ball, towards the page.
function anchorOf(launcher: Launcher): { x: number; y: number } {
  const rect = launcher.element.getBoundingClientRect();
  const corner = launcher.element.getAttribute('data-corner') ?? 'bottom-right';
  return {
    x: corner.endsWith('left') ? rect.right : rect.left,
    y: corner.startsWith('top') ? rect.bottom : rect.top,
  };
}

function centerOf(launcher: Launcher): { x: number; y: number } {
  const rect = launcher.element.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

export function relaySendFeedback({ root, launcher }: FeedbackCtx): RelaySendFeedback {
  const doc = root.ownerDocument;
  const ball = launcher.element;
  const style = doc.createElement('style');
  style.setAttribute(STYLE, '');
  style.textContent = rules();
  root.append(style);
  const status = doc.createElement('span');
  status.className = STATUS;
  status.setAttribute('role', 'status');
  root.append(status);
  let owned: Bubble | null = null;
  let hiddenDots: Dot[] = [];
  const submitted = new Set<Bubble>();
  let gone = false;
  // Every Sent stamp still on screen; each send keeps its own, dispose removes them all.
  const stamps = new Set<{ remove(): void }>();

  const hide = (owner: RelayOwner, first: boolean): void => {
    for (const el of [owner.dot?.element, owner.bubble.element]) el?.setAttribute(GONE, '');
    owner.bubble.element.removeAttribute(ERROR);
    owner.bubble.element.removeAttribute('data-docked');
    if (first) hiddenDots = [];
    if (owner.dot) hiddenDots.push(owner.dot);
    if (owner.dot) owner.dot.element.hidden = true;
    submitted.add(owner.bubble);
    // Anything the bubble shows later, such as Capture screen, opens beside the ball.
    owner.bubble.moveTo(anchorOf(launcher));
  };
  const stop = (): void => {
    for (const name of [RELAY_SENDING, 'aria-busy']) ball.removeAttribute(name);
    status.textContent = '';
  };

  return {
    sending(owner, rest = []) {
      if (gone) return;
      owned = owner.bubble;
      submitted.clear();
      [owner, ...rest].forEach((one, i) => hide(one, i === 0));
      ball.removeAttribute('hidden');
      ball.setAttribute(RELAY_SENDING, '');
      ball.setAttribute('aria-busy', 'true');
      status.textContent = 'Sending';
    },
    submitted: (bubble) => !gone && bubble !== null && submitted.has(bubble),
    owns: (bubble) => !gone && bubble !== null && owned === bubble,
    active: () => !gone && owned !== null,
    sent(owner) {
      if (gone || owned !== owner.bubble) return false;
      owned = null;
      submitted.clear();
      stop();
      owner.bubble.element.removeAttribute(ERROR);
      // The dot's own sent state would stamp at the old point; only its attributes follow.
      for (const dot of new Set([owner.dot, ...hiddenDots])) {
        dot?.element.setAttribute('data-state', 'sent');
        dot?.element.setAttribute('part', 'pin pin-sent');
        dot?.element.setAttribute('aria-label', 'Sent');
      }
      stamps.add(celebrate(root, ball, 'sent', centerOf(launcher)));
      return true;
    },
    error(bubble, message, onRetry) {
      if (gone || bubble === null || owned !== bubble) return false;
      stop();
      submitted.clear();
      bubble.element.removeAttribute(GONE);
      bubble.element.setAttribute(ERROR, '');
      bubble.showError(message, onRetry);
      bubble.moveTo(anchorOf(launcher));
      // corner-pins moves every undocked open bubble back beside its pin on scroll; Retry stays at the ball.
      bubble.element.setAttribute('data-docked', '');
      return true;
    },
    release(bubble) {
      if (gone || bubble === null || owned !== bubble) return;
      owned = null;
      stop();
      for (const name of [GONE, ERROR, 'data-docked']) bubble.element.removeAttribute(name);
      submitted.clear();
      for (const dot of hiddenDots) {
        dot.element.removeAttribute(GONE);
        dot.element.hidden = false;
      }
      hiddenDots = [];
    },
    dispose() {
      gone = true;
      owned = null;
      hiddenDots = [];
      submitted.clear();
      stop();
      stamps.forEach((made) => made.remove());
      stamps.clear();
      status.remove();
      style.remove();
    },
  };
}
