type PassbackGlobal = { autoStart?: unknown };

export type Corner = 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
export type LauncherMode = 'visible' | 'hidden';
export type Hotkey = Readonly<{ alt: boolean; shift: boolean; ctrl: boolean; meta: boolean; code: string }>;
export type Settings = { corner: Corner; launcher: LauncherMode; hotkey: Hotkey | null };

export const DEFAULT_HOTKEY: Hotkey = { alt: true, shift: true, ctrl: false, meta: false, code: 'KeyR' };

// Address of the Passback privacy page; the only place the widget reads it from.
// An empty string means no link is drawn.
export const PRIVACY_URL = '';

const CORNERS: readonly string[] = ['bottom-right', 'bottom-left', 'top-right', 'top-left'];
const MODIFIERS = ['alt', 'shift', 'ctrl', 'meta'] as const;

export function readConfig(doc: Document, win: Window): { autoStart: boolean } {
  const global = (win as unknown as { __passback?: PassbackGlobal }).__passback;
  if (global?.autoStart === false) return { autoStart: false };
  if (doc.querySelector('script[data-passback-auto-start="false"]')) return { autoStart: false };
  return { autoStart: true };
}

export function scriptAttr(doc: Document, name: string): string {
  const value = doc.querySelector('script[' + name + ']')?.getAttribute(name);
  return (value ?? '').trim().toLowerCase();
}

function keyCode(key: string): string {
  if (/^[a-z]$/.test(key)) return 'Key' + key.toUpperCase();
  if (/^[0-9]$/.test(key)) return 'Digit' + key;
  return '';
}

export function parseHotkey(text: string, fallback: Hotkey = DEFAULT_HOTKEY): Hotkey {
  const parts = text.trim().toLowerCase().split('+').map((part) => part.trim());
  const key = parts.pop() ?? '';
  const code = keyCode(key);
  const mods = parts as string[];
  const known = mods.every((mod) => (MODIFIERS as readonly string[]).includes(mod));
  if (!parts.length || !code || !known || new Set(mods).size !== mods.length) return fallback;
  const has = (mod: string): boolean => mods.includes(mod);
  if (!has('alt') && !has('ctrl') && !has('meta')) return fallback;
  return { alt: has('alt'), shift: has('shift'), ctrl: has('ctrl'), meta: has('meta'), code };
}

export function hotkeyOf(text: string, fallback?: Hotkey): Hotkey | null {
  return text === 'off' ? null : parseHotkey(text, fallback);
}

export function readSettings(doc: Document): Settings {
  const corner = scriptAttr(doc, 'data-passback-corner');
  return {
    corner: CORNERS.includes(corner) ? (corner as Corner) : 'bottom-right',
    launcher: scriptAttr(doc, 'data-passback-launcher') === 'hidden' ? 'hidden' : 'visible',
    hotkey: hotkeyOf(scriptAttr(doc, 'data-passback-hotkey')),
  };
}
