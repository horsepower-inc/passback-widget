import { CLASS } from './styles';

type Ctx = { root: ShadowRoot; host: HTMLElement; doc: Document };
type Nav = Navigator & { userAgentData?: { platform?: unknown } };

const SVG = 'http://www.w3.org/2000/svg';
const MIC =
  'M8 1.5a2.5 2.5 0 0 0-2.5 2.5v4a2.5 2.5 0 0 0 5 0V4A2.5 2.5 0 0 0 8 1.5ZM3.5 7.5a4.5 4.5 0 0 0 9 0M8 12v2.5';
const HINTS: [RegExp, string][] = [
  [/^mac/i, 'Press Fn twice to dictate. Nothing leaves your Mac.'],
  [/^win/i, 'Press Win+H to dictate.'],
];
const LAYOUT =
  'display:flex;flex:0 0 100%;justify-content:flex-end;align-items:flex-start;gap:var(--pb-space-gap);text-align:right';
let serial = 0;

function hintOf(doc: Document): string | undefined {
  const win = doc.defaultView as (Window & { __passback?: { hot?: unknown } }) | null;
  const nav = win?.navigator as Nav | undefined;
  if (!win?.__passback?.hot || !nav) return undefined;
  const modern = nav.userAgentData?.platform;
  const platform = typeof modern === 'string' && modern !== '' ? modern : nav.platform;
  return typeof platform === 'string' ? HINTS.find(([re]) => re.test(platform))?.[1] : undefined;
}

function control(doc: Document, textarea: HTMLTextAreaElement, text: string): HTMLElement {
  const box = doc.createElement('div');
  box.dataset.role = 'dictation';
  box.style.cssText = LAYOUT;
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = CLASS.ico;
  button.dataset.role = 'dictation-button';
  button.setAttribute('aria-label', 'Dictation help');
  button.title = text;
  const svg = doc.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  const path = doc.createElementNS(SVG, 'path');
  path.setAttribute('d', MIC);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  svg.appendChild(path);
  button.appendChild(svg);
  const hint = doc.createElement('p');
  hint.className = CLASS.note;
  hint.id = `pb-dictation-${++serial}`;
  hint.hidden = true;
  hint.textContent = text;
  button.setAttribute('aria-describedby', hint.id);
  let pinned = false;
  const show = (): void => void (hint.hidden = false);
  const hide = (): void => void (hint.hidden = pinned ? hint.hidden : true);
  button.addEventListener('pointerenter', show);
  button.addEventListener('focus', show);
  button.addEventListener('pointerleave', hide);
  button.addEventListener('blur', hide);
  button.addEventListener('click', () => {
    if (textarea.disabled) return;
    const { selectionStart: start, selectionEnd: end, selectionDirection: dir } = textarea;
    pinned = true;
    show();
    textarea.focus();
    textarea.setSelectionRange(start, end, dir ?? undefined);
  });
  textarea.addEventListener('input', () => {
    pinned = false;
    hint.hidden = true;
  });
  box.append(hint, button);
  return box;
}

/** Collector-chunk add-on: tells local macOS and Windows users how to dictate with the system's voice typing. */
export function dictationHint(ctx: Ctx): void {
  const { root, host, doc } = ctx;
  const text = hintOf(doc);
  if (text === undefined) return;
  const scan = (): void => {
    for (const textarea of root.querySelectorAll<HTMLTextAreaElement>(`textarea.${CLASS.input}`)) {
      const bar = textarea.nextElementSibling?.classList.contains(CLASS.bar)
        ? textarea.nextElementSibling
        : null;
      const parent = bar ?? textarea.parentElement;
      if (!parent || parent.querySelector('[data-role="dictation"]')) continue;
      if (bar) (bar as HTMLElement).style.flexWrap = 'wrap';
      parent.appendChild(control(doc, textarea, text));
    }
  };
  const observer = new MutationObserver(scan);
  observer.observe(root, { childList: true, subtree: true });
  host.addEventListener('passback:dispose', () => observer.disconnect(), { once: true });
  scan();
}
