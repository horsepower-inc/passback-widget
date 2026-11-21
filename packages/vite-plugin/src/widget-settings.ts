export type WidgetSettings = {
  theme?: 'auto' | 'light' | 'dark';
  main?: string;
  secondary?: string;
  corner?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
  launcher?: 'visible' | 'hidden';
  hotkey?: string;
  hideHotkey?: string;
};

const MODIFIERS: readonly string[] = ['alt', 'shift', 'ctrl', 'meta'];
const HOTKEY_KEY = /^[a-z0-9]$/;

function hotkeyParts(text: string): string[] {
  return text.trim().toLowerCase().split('+').map((part) => part.trim());
}

function partsAreHotkey(parts: string[]): boolean {
  const key = parts.pop() ?? '';
  if (!parts.length || !HOTKEY_KEY.test(key)) return false;
  if (!parts.every((mod) => MODIFIERS.includes(mod))) return false;
  if (new Set(parts).size !== parts.length) return false;
  return parts.some((mod) => mod !== 'shift');
}

export function isHotkey(text: string): boolean {
  return partsAreHotkey(hotkeyParts(text));
}

type Rule = { allowed: (value: string) => boolean; message: string };

const isHotkeyOrOff = (value: string): boolean => value === 'off' || isHotkey(value);
const isColour = (value: string): boolean => /^#[0-9a-f]{6}$/.test(value);
const colourMessage = (name: string): string =>
  `passback: ${name} must be a colour written as #rrggbb, for example #2563eb`;

const RULES: Record<keyof WidgetSettings, Rule> = {
  theme: { allowed: (v) => ['auto', 'light', 'dark'].includes(v), message: 'passback: theme must be auto, light or dark' },
  main: { allowed: isColour, message: colourMessage('main') },
  secondary: { allowed: isColour, message: colourMessage('secondary') },
  corner: {
    allowed: (v) => ['bottom-right', 'bottom-left', 'top-right', 'top-left'].includes(v),
    message: 'passback: corner must be bottom-right, bottom-left, top-right or top-left',
  },
  launcher: { allowed: (v) => ['visible', 'hidden'].includes(v), message: 'passback: launcher must be visible or hidden' },
  hotkey: {
    allowed: isHotkeyOrOff,
    message:
      'passback: hotkey must be modifiers and one letter or digit joined by +, with alt, ctrl or meta among them, for example alt+shift+m',
  },
  hideHotkey: {
    allowed: isHotkeyOrOff,
    message:
      'passback: hideHotkey must be modifiers and one letter or digit joined by +, with alt, ctrl or meta among them, or off',
  },
};

const ATTRS: Record<keyof WidgetSettings, string> = {
  theme: 'data-passback-theme',
  main: 'data-passback-main',
  secondary: 'data-passback-secondary',
  corner: 'data-passback-corner',
  launcher: 'data-passback-launcher',
  hotkey: 'data-passback-hotkey',
  hideHotkey: 'data-passback-hide-hotkey',
};

const KEYS = Object.keys(ATTRS) as (keyof WidgetSettings)[];

function attrValue(key: (typeof KEYS)[number], value: unknown): string {
  const rule = RULES[key];
  const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (typeof value !== 'string' || !rule.allowed(text)) {
    throw new Error(`${rule.message}, got "${String(value)}"`);
  }
  if (key !== 'hotkey' && key !== 'hideHotkey') return text;
  return text === 'off' ? text : hotkeyParts(text).join('+');
}

export function widgetSettingAttrs(settings: WidgetSettings): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const key of KEYS) {
    const value: unknown = settings[key];
    if (value !== undefined) attrs[ATTRS[key]] = attrValue(key, value);
  }
  return attrs;
}
