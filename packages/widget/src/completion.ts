import { flyMs } from './fly';
import { BALL_PATH } from './launcher';
import { moveStamp, showStamp } from './stamp';
import { CLASS } from './styles';

type Point = { x: number; y: number };

export const COMPLETION_ATTR = 'data-pb-celebrate';
const STYLE_ATTR = 'data-pb-completion-styles';
const SVG_NS = 'http://www.w3.org/2000/svg';
const TEXT = { sent: 'SENT!', done: 'FIXED ✓' } as const;
const RAYS = { sent: 10, done: 14 } as const;
const STREAKS = [26, 34, 22];
const STAMP = `.pb-stamp.pb-stamp[${COMPLETION_ATTR}]`;
const STILL = 'display: block; animation: none; opacity: 1; transform: rotate(-8deg);';

export function completionRules(): string {
  return `.pb-cb-fx, .pb-cb-shot { position: absolute; left: 0; top: 0; pointer-events: none; }
.pb-cb-shot { width: 20px; height: 20px; margin: -10px 0 0 -10px; color: var(--pb-color-glow); }
.pb-cb-shot svg { display: block; width: 20px; height: 20px; fill: currentColor; }
.pb-cb-streak { position: absolute; right: 100%; height: 2px; background: linear-gradient(to left, var(--pb-color-glow), var(--pb-color-flame)); }
.pb-cb-flame { position: absolute; right: 100%; top: 6px; width: 14px; height: 8px; border-radius: 50% 0 0 50%; background: var(--pb-color-flame); transform-origin: 100% 50%; animation: pb-cb-flicker var(--pb-motion-spin) var(--pb-motion-ease) infinite alternate; }
.pb-cb-ray { position: absolute; top: -1px; width: 8px; height: 2px; background: var(--pb-color-glow); transform-origin: 0 50%; animation: pb-cb-ray var(--pb-motion-duration) var(--pb-motion-ease) both; }
.pb-cb-ring { position: absolute; left: -6px; top: -6px; width: 12px; height: 12px; border: 2px solid var(--pb-color-glow); border-radius: 50%; animation: pb-cb-ring calc(var(--pb-motion-duration) * 2) var(--pb-motion-ease) both; }
.pb-cb-spark { position: absolute; left: -2px; top: -2px; width: 5px; height: 5px; background: var(--pb-color-glow); animation: pb-cb-spark calc(var(--pb-motion-duration) * 3) var(--pb-motion-ease) both; }
${STAMP} { padding: 0; border-radius: 0; background: transparent; color: var(--pb-color-glow); text-shadow: 3px 3px 0 #000; animation-delay: var(--pb-motion-fly); animation-fill-mode: both; }
${STAMP}[data-pb-static] { ${STILL} }
@keyframes pb-cb-flicker { from { transform: scale(1, 0.7); opacity: 0.7; } to { transform: scale(1.4, 1.1); opacity: 1; } } @keyframes pb-cb-ray { from { transform: rotate(var(--pb-a)) translateX(10px) scaleX(0.2); opacity: 1; } to { transform: rotate(var(--pb-a)) translateX(24px); opacity: 0; } }
@keyframes pb-cb-ring { from { transform: scale(0.5); opacity: 1; } to { transform: scale(3); opacity: 0; } } @keyframes pb-cb-spark { from { transform: rotate(var(--pb-a)) translateX(12px) scale(0); opacity: 1; } to { transform: rotate(var(--pb-a)) translateX(32px) scale(1.2); opacity: 0; } }
@media (prefers-reduced-motion: reduce) { ${STAMP} { ${STILL} } .pb-cb-fx, .pb-cb-shot { display: none; } }`;
}

function install(root: ShadowRoot): void {
  if (root.querySelector(`style[${STYLE_ATTR}]`)) return;
  const style = root.appendChild(root.ownerDocument.createElement('style'));
  style.setAttribute(STYLE_ATTR, '');
  style.textContent = completionRules();
}

function add(parent: HTMLElement | ShadowRoot, cls: string, angle?: number): HTMLElement {
  const el = (parent.ownerDocument ?? document).createElement('div');
  el.className = cls;
  if (angle !== undefined) el.style.setProperty('--pb-a', `${angle}deg`);
  return parent.appendChild(el);
}

function makeShot(root: ShadowRoot): HTMLElement {
  const shot = add(root, 'pb-cb-shot');
  shot.setAttribute('aria-hidden', 'true');
  STREAKS.forEach((w, i) => {
    Object.assign(add(shot, 'pb-cb-streak').style, { top: `${3 + i * 6}px`, width: `${w}px` });
  });
  add(shot, 'pb-cb-flame');
  const svg = shot.appendChild(root.ownerDocument.createElementNS(SVG_NS, 'svg'));
  svg.setAttribute('viewBox', '0 0 28 28');
  svg.appendChild(root.ownerDocument.createElementNS(SVG_NS, 'path')).setAttribute('d', BALL_PATH);
  return shot;
}

function burst(fx: HTMLElement, state: 'sent' | 'done'): void {
  const n = RAYS[state];
  for (let i = 0; i < n; i++) add(fx, 'pb-cb-ray', (i * 360) / n);
  add(fx, 'pb-cb-ring');
  if (state === 'sent') return;
  add(fx, 'pb-cb-ring').style.animationDelay = 'var(--pb-motion-duration)';
  for (let i = 0; i < 6; i++) add(fx, 'pb-cb-spark', i * 60 + 30);
}

function launcherCentre(root: ShadowRoot, win: Window): Point | null {
  const el = root.querySelector<HTMLElement>(`.${CLASS.launcher}`);
  if (!el?.isConnected || el.hidden) return null;
  const css = win.getComputedStyle(el);
  if (css.display === 'none' || ['hidden', 'collapse'].includes(css.visibility)) return null;
  const r = el.getBoundingClientRect();
  if (!(r.width > 0 && r.height > 0 && Number.isFinite(r.left + r.top))) return null;
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

export class Celebration {
  private over = false;
  private frame: number | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private shot: HTMLElement | null = null;
  private fly: Animation | null = null;
  private snap: Animation | null = null;
  private from: Point | null = null;
  private m = { fly: 420, stamp: 1800, duration: 160, ease: 'ease-out' };
  private readonly win: Window | null;
  private readonly fx: HTMLElement;
  private readonly stamp: HTMLElement;

  constructor(
    private readonly root: ShadowRoot,
    private readonly dot: HTMLElement,
    private readonly state: 'sent' | 'done',
    private at: Point,
  ) {
    install(root);
    this.win = root.ownerDocument.defaultView;
    this.fx = add(root, 'pb-cb-fx');
    this.stamp = showStamp(root, at);
    this.stamp.textContent = TEXT[state];
    this.stamp.setAttribute(COMPLETION_ATTR, state);
    this.move(at);
    this.safe(() => this.begin());
  }

  private safe(fn: () => void): void {
    if (this.over) return;
    try {
      fn();
    } catch {
      this.still();
    }
  }

  private begin(): void {
    const win = this.win;
    if (!win) return this.still();
    const style = win.getComputedStyle(this.root.host);
    const read = (name: string): string => style.getPropertyValue(`--pb-motion-${name}`).trim();
    for (const k of ['fly', 'stamp', 'duration'] as const) if (read(k)) this.m[k] = flyMs(read(k));
    this.m.ease = read('ease') || this.m.ease;
    if (win.matchMedia('(prefers-reduced-motion: reduce)').matches) return this.still();
    this.timer = setTimeout(() => this.remove(), this.m.fly + this.m.stamp);
    this.frame = win.requestAnimationFrame(() => {
      this.frame = null;
      this.safe(() => this.launch(win));
    });
  }

  private launch(win: Window): void {
    const from = launcherCentre(this.root, win);
    if (!from || typeof this.dot.animate !== 'function') return this.still();
    this.from = from;
    this.shot = makeShot(this.root);
    const timing = { duration: this.m.fly, easing: this.m.ease, fill: 'forwards' as const };
    this.fly = this.shot.animate(this.path(from), timing);
    this.fly.onfinish = () => this.safe(() => this.impact());
    this.fly.oncancel = () => this.still();
  }

  private path(from: Point): Keyframe[] {
    const turn = `rotate(${Math.atan2(this.at.y - from.y, this.at.x - from.x)}rad)`;
    return [from, this.at].map((p) => ({ transform: `translate(${p.x}px, ${p.y}px) ${turn}` }));
  }

  private impact(): void {
    if (!this.drop()) return this.still();
    burst(this.fx, this.state);
    const keys = [1, 1.5, 0.9, 1].map((s) => ({ transform: `translate(-50%, -50%) scale(${s})` }));
    this.snap = this.dot.animate(keys, { duration: this.m.duration, easing: this.m.ease });
  }

  private drop(): boolean {
    let ok = true;
    for (const a of [this.fly, this.snap]) {
      if (a) a.onfinish = a.oncancel = null;
      try {
        a?.cancel();
      } catch {
        // A throwing cancel must not stop the cleanup below.
        ok = false;
      }
    }
    this.fly = this.snap = null;
    this.shot?.remove();
    this.shot = null;
    return ok;
  }

  private still(): void {
    if (this.over) return;
    this.drop();
    this.fx.replaceChildren();
    this.stamp.setAttribute('data-pb-static', '');
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.remove(), this.m.stamp);
  }

  move(next: Point): void {
    if (this.over) return;
    this.at = next;
    Object.assign(this.fx.style, { left: `${next.x}px`, top: `${next.y}px` });
    moveStamp(this.stamp, next);
    const { fly, from } = this;
    if (fly && from) this.safe(() => (fly.effect as KeyframeEffect).setKeyframes(this.path(from)));
  }

  remove(): void {
    this.over = true;
    if (this.frame !== null) this.win?.cancelAnimationFrame(this.frame);
    clearTimeout(this.timer);
    this.drop();
    this.fx.remove();
    this.stamp.remove();
  }
}
