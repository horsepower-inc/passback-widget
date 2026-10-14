import type { Hotkey, Settings } from './config';
import { DEFAULT_HOTKEY } from './config';
import { CLASS } from './styles';

const SVG_NS = 'http://www.w3.org/2000/svg';

// Football glyph: Font Awesome 4 "futbol-o" by Dave Gandy, SIL OFL 1.1 (https://scripts.sil.org/OFL).
export const BALL_PATH =
  'M9.516 12.75l4.484-3.25 4.484 3.25-1.703 5.25h-5.547zM14 0c7.734 0 14 6.266 14 14s-6.266 14-14 14-14-6.266-14-14 6.266-14 14-14zM23.672 21.094c1.469-2 2.328-4.438 2.328-7.094v-0.047l-1.594 1.391-3.75-3.5 0.984-5.047 2.094 0.187c-1.484-2.047-3.609-3.625-6.078-4.406l0.828 1.937-4.484 2.484-4.484-2.484 0.828-1.937c-2.469 0.781-4.594 2.359-6.078 4.406l2.109-0.187 0.969 5.047-3.75 3.5-1.594-1.391v0.047c0 2.656 0.859 5.094 2.328 7.094l0.469-2.063 5.094 0.625 2.172 4.656-1.813 1.078c1.172 0.391 2.438 0.609 3.75 0.609s2.578-0.219 3.75-0.609l-1.813-1.078 2.172-4.656 5.094-0.625z';

export type Launcher = {
  element: HTMLButtonElement;
  setVisible(visible: boolean): void;
  setCount(count: number): void;
  update(marks: readonly { lastState: string }[]): void;
  destroy(): void;
};

function createBall(doc: Document): SVGSVGElement {
  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 28 28');
  svg.setAttribute('width', '20');
  svg.setAttribute('height', '20');
  svg.setAttribute('fill', 'currentColor');
  svg.setAttribute('aria-hidden', 'true');
  const path = doc.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', BALL_PATH);
  svg.appendChild(path);
  return svg;
}

type LauncherSettings = Pick<Settings, 'corner' | 'launcher'>;
type PinMark = { lastState: string };

function isOpen(mark: PinMark): boolean {
  return mark.lastState !== 'done' && mark.lastState !== 'sent';
}

const DEFAULT_SETTINGS: LauncherSettings = { corner: 'bottom-right', launcher: 'visible' };

export function createLauncher(
  root: ShadowRoot,
  onArm: () => void,
  settings: LauncherSettings = DEFAULT_SETTINGS,
): Launcher {
  const doc = root.ownerDocument;
  const element = doc.createElement('button');
  element.type = 'button';
  element.className = CLASS.launcher;
  element.setAttribute('data-corner', settings.corner);
  if (settings.launcher === 'hidden') element.setAttribute('hidden', '');
  let pins = 0;
  element.setAttribute('aria-label', 'Passback: pin a comment');
  const badge = doc.createElement('span');
  badge.className = CLASS.count;
  badge.setAttribute('hidden', '');
  element.append(createBall(doc), badge);
  element.addEventListener('click', onArm);
  root.appendChild(element);

  function setCount(count: number): void {
    if (!Number.isFinite(count) || count < 1) {
      badge.setAttribute('hidden', '');
      badge.textContent = '';
    } else {
      badge.textContent = String(Math.floor(count));
      badge.removeAttribute('hidden');
    }
  }

  return {
    element,
    setCount,
    update(marks: readonly PinMark[]): void {
      pins = marks.length;
      setCount(marks.filter(isOpen).length);
    },
    setVisible(visible: boolean): void {
      if (visible && (settings.launcher === 'visible' || pins >= 1)) {
        element.removeAttribute('hidden');
      } else {
        element.setAttribute('hidden', '');
      }
    },
    destroy(): void {
      element.remove();
    },
  };
}

export function showLauncher(launcher: Launcher, marks: readonly PinMark[]): void {
  launcher.update(marks);
  launcher.setVisible(true);
}

export function matchesHotkey(event: KeyboardEvent, hotkey: Hotkey): boolean {
  return (
    event.code === hotkey.code &&
    event.altKey === hotkey.alt &&
    event.shiftKey === hotkey.shift &&
    event.ctrlKey === hotkey.ctrl &&
    event.metaKey === hotkey.meta
  );
}

export function typing(event: Event): boolean {
  const target = event.composedPath()[0] as Element | undefined;
  return target?.tagName === 'TEXTAREA' && target.getRootNode() instanceof ShadowRoot;
}

export function listenForHotkey(
  doc: Document,
  onArm: () => void,
  hotkey: Hotkey | null = DEFAULT_HOTKEY,
): () => void {
  if (!hotkey) return () => undefined;
  function onKeyDown(event: KeyboardEvent): void {
    if (event.repeat || !matchesHotkey(event, hotkey as Hotkey) || typing(event)) return;
    onArm();
    event.preventDefault();
  }

  doc.addEventListener('keydown', onKeyDown, true);

  return () => {
    doc.removeEventListener('keydown', onKeyDown, true);
  };
}
