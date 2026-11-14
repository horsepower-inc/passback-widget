import type { Boundary } from './boundary';
import { keptFull } from './kept';
import type { Launcher } from './launcher';
import type { MarkRows } from './overlay-mark-rows';
import { dispatch, type FlowCtx } from './overlay-draw';
import { KEPT_FULL_NOTE } from './overlay-marks';
import { resetSubmission, type SubmitCtx } from './overlay-submit';
import { CLASS } from './styles';
import { STAMP_CLASS } from './stamp';
import type { Corner, Tray } from './tray-view';
import { TRAY_CLASS, createTray } from './tray-view';

export type Panel = {
  press(): void;
  dismiss(): void;
  resume(): boolean;
  reveal(): void;
  refresh(): void;
  syncDraw(): void;
  dispose(): void;
};

type PanelCtx = {
  root: ShadowRoot;
  host: HTMLElement;
  guard: Boundary['guard'];
  launcher: Launcher;
  rows: MarkRows;
};

const ATTRIBUTE = 'data-pb-panel';
const STYLE = 'data-pb-panel-styles';
const DRAFTING = ['composing', 'drawing'];
const CORNERS = ['bottom-right', 'bottom-left', 'top-right', 'top-left'];
const LIVE = ['armed', ...DRAFTING];

function rules(): string {
  const hidden = [CLASS.dot, CLASS.bubble, STAMP_CLASS, TRAY_CLASS.tray]
    .map((name) => `:host([${ATTRIBUTE}='closed']) .${name}`)
    .join(',\n');
  // While a send is pending or failed the ball hides, but its rows stay deletable.
  const away = `:host(:not([data-passback-phase='sending'])) .${CLASS.launcher}[hidden]`;
  return `${hidden} { display: none !important; }\n${away} ~ .${TRAY_CLASS.tray} { display: none; }`;
}

const draftOf = ({ state }: FlowCtx): string =>
  state.bubble?.element.querySelector('textarea')?.value.trim() ?? '';
type Ctx = PanelCtx & SubmitCtx;
const openOf = (host: HTMLElement): boolean => host.getAttribute(ATTRIBUTE) === 'open';

// While Point is active the launcher is the close control, even when configured hidden.
function linkLauncher({ host, launcher, state }: Ctx, refresh: () => void) {
  const label = launcher.element.getAttribute('aria-label') ?? '';
  const [setVisible, update] = [launcher.setVisible, launcher.update];
  const sync = (): void => {
    const on = openOf(host) && LIVE.includes(state.flow);
    launcher.element.setAttribute('aria-label', on ? 'Passback: close' : label);
    launcher.element.toggleAttribute('data-open', on);
    if (on) launcher.element.removeAttribute('hidden');
    else if (openOf(host) && state.flow === 'sending') launcher.element.setAttribute('hidden', '');
    host.dispatchEvent(new Event('passback:sync'));
  };
  launcher.setVisible = (visible) => {
    setVisible(visible);
    sync();
    if (visible && openOf(host)) refresh();
  };
  // A draft is not a kept comment, so the badge leaves it out.
  launcher.update = (marks: readonly { lastState: string; bubble?: unknown }[]) =>
    update(marks.filter((m) => !DRAFTING.includes(state.flow) || m.bubble !== state.bubble));
  const restore = (): void => {
    Object.assign(launcher, { setVisible, update });
    host.dispatchEvent(new Event('passback:dispose'));
  };
  return { sync, restore };
}

// Escape from the page or the shadow root; each physical key event counts once.
// Each keydown passes here before the bubble's, so `composing` tells Panel.dismiss of IME keys.
function listenForEscape(ctx: Ctx, dismiss: () => void) {
  const seen = new WeakSet<Event>();
  let ime = false;
  const onKey = (event: Event): void => {
    const { key, isComposing, keyCode } = event as KeyboardEvent;
    ime = isComposing || keyCode === 229;
    if (key !== 'Escape' || ime || seen.has(event)) return;
    seen.add(event);
    ctx.guard(dismiss)();
  };
  const targets = [ctx.root.ownerDocument, ctx.root];
  targets.forEach((target) => target.addEventListener('keydown', onKey, true));
  return {
    composing: () => ime,
    stop: () => targets.forEach((target) => target.removeEventListener('keydown', onKey, true)),
  };
}

// Closes the panel: a full list parks its draft, a pending send keeps its owner, else it settles.
function leave(ctx: Ctx): void {
  const park = ctx.state.flow === 'sending' || (draftOf(ctx) !== '' && keptFull(ctx.state.kept));
  if (dispatch(ctx, park ? 'park' : 'cancel') && !park) resetSubmission(ctx.state);
  ctx.host.setAttribute(ATTRIBUTE, 'closed');
}

// Reopening a dismissed composition or unsettled send restores it as it was.
function resumeOf(ctx: Ctx, reveal: () => void): boolean {
  const { host, state } = ctx;
  if (openOf(host) || !dispatch(ctx, 'reopen')) return false;
  reveal();
  if (state.flow === 'composing' && keptFull(state.kept)) state.bubble?.showNote(KEPT_FULL_NOTE);
  return true;
}

export function createPanel(ctx: Ctx, hooks: { arm(): void; idle(): void }): Panel {
  const { root, host, state } = ctx;
  const style = root.ownerDocument.createElement('style');
  style.setAttribute(STYLE, '');
  style.textContent = rules();
  root.append(style);
  host.setAttribute(ATTRIBUTE, 'closed');
  const corner = ctx.launcher.element.getAttribute('data-corner');
  const tray: Tray = createTray(root, {
    corner: CORNERS.includes(corner as Corner) ? (corner as Corner) : undefined,
    onSendAll: ctx.guard(() => void host.dispatchEvent(new Event('passback:send-all'))),
    onDiscardAll: ctx.guard(() => ctx.rows.discardAll()),
  });
  const link = linkLauncher(ctx, () => refresh());
  const syncDraw = (): void => link.sync();
  const refresh = (): void => {
    syncDraw();
    state.bubble?.setKept(state.kept.items.length);
    tray.render(ctx.rows.rows());
  };
  const reveal = (): void => {
    host.setAttribute(ATTRIBUTE, 'open');
    refresh();
    link.sync();
  };
  const dismiss = (): void => {
    if (!openOf(host)) return;
    leave(ctx);
    hooks.idle();
  };
  if (ctx.drawing) refresh();
  const escape = listenForEscape(ctx, dismiss);
  return {
    press() {
      if (openOf(host) && LIVE.includes(state.flow)) return dismiss();
      hooks.arm();
      if (openOf(host)) refresh();
    },
    dismiss: () => void (escape.composing() || dismiss()),
    resume: () => resumeOf(ctx, reveal),
    reveal,
    syncDraw,
    refresh,
    dispose() {
      escape.stop();
      link.restore();
      tray.destroy();
      style.remove();
      host.removeAttribute(ATTRIBUTE);
    },
  };
}
