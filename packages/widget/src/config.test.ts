// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_HOTKEY, hotkeyOf, parseHotkey, readConfig, readSettings, scriptAttr } from './config';

type Cfg = { __passback?: unknown };

function makeWin(passback?: unknown): Window {
  const win = {} as Window & Cfg;
  if (passback !== undefined) win.__passback = passback;
  return win;
}

function makeDoc(...html: string[]): Document {
  const doc = document.implementation.createHTMLDocument('');
  doc.body.innerHTML = html.join('');
  return doc;
}

const optOut = '<script data-passback-auto-start="false"></script>';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('readConfig', () => {
  it('defaults autoStart to true without an exact opt-out', () => {
    expect(readConfig(makeDoc(), makeWin()).autoStart).toBe(true);
    expect(readConfig(makeDoc(), makeWin({})).autoStart).toBe(true);
    expect(readConfig(makeDoc(), makeWin({ autoStart: true })).autoStart).toBe(true);
    for (const value of ['false', 0, null, '', 'no']) {
      expect(readConfig(makeDoc(), makeWin({ autoStart: value })).autoStart).toBe(true);
    }
    expect(readConfig(makeDoc('<script data-other="x"></script>'), makeWin()).autoStart).toBe(true);
    for (const value of ['', 'true', 'False', ' false ']) {
      const doc = makeDoc(`<script data-passback-auto-start="${value}"></script>`);
      expect(readConfig(doc, makeWin()).autoStart).toBe(true);
    }
    const div = makeDoc('<div data-passback-auto-start="false"></div>');
    expect(readConfig(div, makeWin()).autoStart).toBe(true);
  });

  it('disables autoStart when either source opts out', () => {
    expect(readConfig(makeDoc(), makeWin({ autoStart: false })).autoStart).toBe(false);
    expect(readConfig(makeDoc(optOut), makeWin()).autoStart).toBe(false);
    expect(readConfig(makeDoc(optOut), makeWin({ autoStart: false })).autoStart).toBe(false);
    expect(readConfig(makeDoc(optOut), makeWin({ autoStart: true })).autoStart).toBe(false);
    const tagTrue = makeDoc('<script data-passback-auto-start="true"></script>');
    expect(readConfig(tagTrue, makeWin({ autoStart: false })).autoStart).toBe(false);

    const many = makeDoc('<script data-other="a"></script>', '<script></script>', optOut);
    expect(readConfig(many, makeWin()).autoStart).toBe(false);

    document.body.innerHTML = optOut;
    expect(readConfig(makeDoc(), makeWin()).autoStart).toBe(true);
    expect(readConfig(makeDoc(optOut), makeWin()).autoStart).toBe(false);
  });
});

const script = (attr: string, value: string): string => `<script ${attr}="${value}"></script>`;

describe('readSettings', () => {
  it('reads the default corner, launcher and hotkey when no script tag sets them', () => {
    expect(readSettings(makeDoc())).toEqual({
      corner: 'bottom-right',
      launcher: 'visible',
      hotkey: DEFAULT_HOTKEY,
    });
  });

  it('reads each of the four corners and falls back to bottom-right on anything else', () => {
    for (const corner of ['bottom-right', 'bottom-left', 'top-right', 'top-left']) {
      expect(readSettings(makeDoc(script('data-passback-corner', corner))).corner).toBe(corner);
    }
    for (const corner of ['', 'middle', 'left', 'top']) {
      expect(readSettings(makeDoc(script('data-passback-corner', corner))).corner).toBe('bottom-right');
    }
  });

  it('reads launcher hidden and falls back to visible on anything else', () => {
    expect(readSettings(makeDoc(script('data-passback-launcher', 'hidden'))).launcher).toBe('hidden');
    for (const value of ['', 'visible', 'none', 'false']) {
      expect(readSettings(makeDoc(script('data-passback-launcher', value))).launcher).toBe('visible');
    }
  });

  it('takes each setting from the first script tag that carries it and ignores other elements', () => {
    const doc = makeDoc(
      '<div data-passback-launcher="hidden"></div>',
      '<script data-passback-corner="top-left" data-passback-hotkey="ctrl+k"></script>',
      '<script data-passback-launcher="hidden" data-passback-corner="top-right"></script>',
    );
    expect(readSettings(doc)).toEqual({
      corner: 'top-left',
      launcher: 'hidden',
      hotkey: { alt: false, shift: false, ctrl: true, meta: false, code: 'KeyK' },
    });
    expect(readSettings(makeDoc('<div data-passback-launcher="hidden"></div>')).launcher).toBe('visible');
  });
});

describe('parseHotkey', () => {
  it('parses modifiers and one letter or digit, ignoring case and spaces', () => {
    expect(parseHotkey('ctrl+shift+k')).toEqual({ alt: false, shift: true, ctrl: true, meta: false, code: 'KeyK' });
    expect(parseHotkey('ALT+2')).toEqual({ alt: true, shift: false, ctrl: false, meta: false, code: 'Digit2' });
    expect(parseHotkey(' Meta + Alt + x ')).toEqual({ alt: true, shift: false, ctrl: false, meta: true, code: 'KeyX' });
    expect(parseHotkey('alt+shift+m')).toEqual(DEFAULT_HOTKEY);
  });

  it('falls back to alt+shift+m when the hotkey cannot be parsed', () => {
    const texts = ['', 'm', 'shift+m', 'alt+shift', 'alt+alt+m', 'alt+mm', 'alt++m', 'alt+', '+', 'm+alt', 'cmd+k', 'alt+f1', 'alt+é'];
    for (const text of texts) expect(parseHotkey(text)).toEqual(DEFAULT_HOTKEY);
  });
});

describe('hotkey settings', () => {
  it('reads off for the open hotkey and keeps the default for blank or invalid text', () => {
    expect(readSettings(makeDoc(script('data-passback-hotkey', ' OFF '))).hotkey).toBeNull();
    expect(readSettings(makeDoc(script('data-passback-hotkey', 'nope'))).hotkey).toEqual(DEFAULT_HOTKEY);
    expect(readSettings(makeDoc(script('data-passback-hotkey', ''))).hotkey).toEqual(DEFAULT_HOTKEY);
    expect(hotkeyOf('off')).toBeNull();
    expect(hotkeyOf('ctrl+k')?.code).toBe('KeyK');
  });

  it('parseHotkey takes a fallback for blank or invalid text', () => {
    const other = { ...DEFAULT_HOTKEY, code: 'KeyH' };
    expect(parseHotkey('', other)).toBe(other);
    expect(parseHotkey('m', other)).toBe(other);
    expect(parseHotkey('shift+h', other)).toBe(other);
    expect(parseHotkey('alt+k', other).code).toBe('KeyK');
    expect(hotkeyOf('bad', other)).toBe(other);
  });
});

describe('scriptAttr', () => {
  it('trims and lower-cases a script attribute and returns an empty text when it is absent', () => {
    const doc = makeDoc(script('data-passback-corner', '  Top-Left '));
    expect(scriptAttr(doc, 'data-passback-corner')).toBe('top-left');
    expect(scriptAttr(doc, 'data-passback-hotkey')).toBe('');
    expect(scriptAttr(makeDoc(), 'data-passback-corner')).toBe('');
  });
});
