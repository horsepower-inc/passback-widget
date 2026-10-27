import type { Hotkey } from './config';
import { hotkeyOf, readSettings, scriptAttr } from './config';
import { matchesHotkey, typing } from './launcher';
import { STAMP_CLASS } from './stamp';
import { CLASS } from './styles';

export const DEFAULT_HIDE_HOTKEY: Hotkey = { alt: true, shift: true, ctrl: false, meta: false, code: 'KeyH' };

const ATTR = 'data-pb-hide';

/** Add-on: a second hotkey that hides dots, bubbles and stamps until pressed again; it is not state. */
export function hideMarks({ root, host, doc }: { root: ShadowRoot; host: HTMLElement; doc: Document }): void {
  const hotkey = hotkeyOf(scriptAttr(doc, 'data-passback-hide-hotkey'), DEFAULT_HIDE_HOTKEY);
  if (!hotkey) return;
  const style = doc.createElement('style');
  style.textContent = [CLASS.dot, CLASS.bubble, STAMP_CLASS]
    .map((name) => `:host([${ATTR}]) .${name}`)
    .join(', ') + ' { display: none !important; }';
  root.appendChild(style);

  function onKeyDown(event: KeyboardEvent): void {
    const open = readSettings(doc).hotkey;
    if (event.repeat || !matchesHotkey(event, hotkey as Hotkey) || typing(event)) return;
    if (open && matchesHotkey(event, open)) return;
    host.toggleAttribute(ATTR);
    event.preventDefault();
  }

  function dispose(): void {
    doc.removeEventListener('keydown', onKeyDown, true);
    host.removeEventListener('passback:dispose', dispose);
    host.removeAttribute(ATTR);
    style.remove();
  }

  doc.addEventListener('keydown', onKeyDown, true);
  host.addEventListener('passback:dispose', dispose);
}
