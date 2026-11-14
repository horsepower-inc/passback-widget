export const FLY_CLASS = 'pb-fly';
export const FLY_FALLBACK_MS = 420;
export const BUMP_MS = 220;

const STYLE_ATTR = 'data-pb-fly-styles';
const OFFSET_Y = 18;

export type FlyOptions = {
  root: ShadowRoot;
  from: { x: number; y: number };
  to: HTMLElement;
  text: string;
  win?: Window;
};

export function flyMs(value: string): number {
  const m = /^(\d*\.?\d+)(ms|s)$/.exec(value.trim());
  if (!m) return FLY_FALLBACK_MS;
  const ms = Number(m[1]) * (m[2] === 's' ? 1000 : 1);
  return ms > 0 ? ms : FLY_FALLBACK_MS;
}

export function flyRules(): string {
  return (
    '.pb-fly { position: absolute; max-width: var(--pb-size-box); padding: calc(var(--pb-space-gap) * 0.75) var(--pb-space-pad); border: thin solid var(--pb-color-border); border-radius: var(--pb-radius-box); background: var(--pb-color-surface); color: var(--pb-color-text); font: var(--pb-font-body); box-shadow: var(--pb-shadow-box); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; pointer-events: none; transform-origin: 0 0; }'
  );
}

function launcherUsable(to: HTMLElement): boolean {
  return to.isConnected && !to.hasAttribute('hidden') && to.getBoundingClientRect().width > 0;
}

function allowed(win: Window | null | undefined, to: HTMLElement): win is Window {
  if (!win) return false;
  if (win.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  return launcherUsable(to);
}

function makeChip(opts: FlyOptions): HTMLElement {
  const chip = opts.root.ownerDocument.createElement('div');
  chip.className = FLY_CLASS;
  chip.setAttribute('aria-hidden', 'true');
  chip.textContent = opts.text;
  chip.style.left = opts.from.x + 'px';
  chip.style.top = opts.from.y + OFFSET_Y + 'px';
  return chip;
}

function mount(root: ShadowRoot, chip: HTMLElement): void {
  if (!root.querySelector('style[' + STYLE_ATTR + ']')) {
    const style = root.ownerDocument.createElement('style');
    style.setAttribute(STYLE_ATTR, '');
    style.textContent = flyRules();
    root.appendChild(style);
  }
  root.appendChild(chip);
}

function bump(to: HTMLElement): void {
  if (!to.isConnected) return;
  to.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.18)' }, { transform: 'scale(1)' }], {
    duration: BUMP_MS,
    easing: 'ease-out',
  });
}

function fly(chip: HTMLElement, opts: FlyOptions, win: Window): void {
  const b = opts.to.getBoundingClientRect();
  const dx = b.left + b.width / 2 - opts.from.x;
  const dy = b.top + b.height / 2 - opts.from.y - OFFSET_Y;
  const duration = flyMs(win.getComputedStyle(opts.root.host).getPropertyValue('--pb-motion-fly'));
  const anim = chip.animate(
    [
      { transform: 'translate(0,0) scale(1)', opacity: 1 },
      { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(.1)', opacity: 0.2 },
    ],
    { duration, easing: 'cubic-bezier(.5,0,.8,.4)', fill: 'forwards' },
  );
  anim.onfinish = () => {
    chip.remove();
    bump(opts.to);
  };
  anim.oncancel = () => chip.remove();
}

export function flyToLauncher(opts: FlyOptions): boolean {
  let chip: HTMLElement | undefined;
  try {
    const win = opts.win ?? opts.root.ownerDocument.defaultView;
    if (!allowed(win, opts.to)) return false;
    const made = makeChip(opts);
    if (typeof made.animate !== 'function') return false;
    chip = made;
    mount(opts.root, chip);
    fly(chip, opts, win);
    return true;
  } catch {
    chip?.remove();
    return false;
  }
}
