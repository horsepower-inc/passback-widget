import { describe, expect, it } from 'vitest';
import { isHotkey, widgetSettingAttrs, type WidgetSettings } from './widget-settings';

describe('widgetSettingAttrs', () => {
  it('returns no attribute when no setting is given', () => {
    expect(widgetSettingAttrs({})).toEqual({});
    expect(widgetSettingAttrs({ theme: undefined })).toEqual({});
  });

  it('maps each of the six settings to its data-passback attribute', () => {
    expect(
      widgetSettingAttrs({
        theme: 'dark',
        main: '#2563eb',
        secondary: '#111111',
        corner: 'top-left',
        launcher: 'hidden',
        hotkey: 'alt+shift+m',
      }),
    ).toEqual({
      'data-passback-theme': 'dark',
      'data-passback-main': '#2563eb',
      'data-passback-secondary': '#111111',
      'data-passback-corner': 'top-left',
      'data-passback-launcher': 'hidden',
      'data-passback-hotkey': 'alt+shift+m',
    });
  });

  it('trims and lower-cases every value', () => {
    const settings = { theme: ' Dark ', main: '#2563EB', hotkey: ' Ctrl + Shift + K ' } as unknown as WidgetSettings;
    expect(widgetSettingAttrs(settings)).toEqual({
      'data-passback-theme': 'dark',
      'data-passback-main': '#2563eb',
      'data-passback-hotkey': 'ctrl+shift+k',
    });
  });

  it('ignores keys that are not look settings', () => {
    const options = { buildId: 'b1', stagingModes: ['staging'], root: '/x' };
    expect(widgetSettingAttrs(options as unknown as WidgetSettings)).toEqual({});
  });

  it('throws a plain message naming the setting and the value', () => {
    const cases: [WidgetSettings, string][] = [
      [{ theme: 'blue' } as unknown as WidgetSettings, 'passback: theme must be auto, light or dark, got "blue"'],
      [
        { corner: 'middle' } as unknown as WidgetSettings,
        'passback: corner must be bottom-right, bottom-left, top-right or top-left, got "middle"',
      ],
      [
        { launcher: 'off' } as unknown as WidgetSettings,
        'passback: launcher must be visible or hidden, got "off"',
      ],
      [
        { main: 'red' },
        'passback: main must be a colour written as #rrggbb, for example #2563eb, got "red"',
      ],
      [
        { secondary: '#fff' },
        'passback: secondary must be a colour written as #rrggbb, for example #2563eb, got "#fff"',
      ],
      [
        { hotkey: 'shift+m' },
        'passback: hotkey must be modifiers and one letter or digit joined by +, with alt, ctrl or meta among them, for example alt+shift+m, got "shift+m"',
      ],
    ];
    for (const [settings, message] of cases) {
      expect(() => widgetSettingAttrs(settings)).toThrow(new Error(message));
    }
  });

  it('throws for a value that is not a string', () => {
    expect(() => widgetSettingAttrs({ corner: 3 } as unknown as WidgetSettings)).toThrow(
      'passback: corner must be bottom-right, bottom-left, top-right or top-left, got "3"',
    );
  });
});

describe('hideHotkey and off', () => {
  it('maps hideHotkey to data-passback-hide-hotkey', () => {
    expect(widgetSettingAttrs({ hideHotkey: ' Ctrl + Alt + H ' })).toEqual({ 'data-passback-hide-hotkey': 'ctrl+alt+h' });
  });

  it('accepts off for hotkey and hideHotkey', () => {
    expect(widgetSettingAttrs({ hotkey: ' OFF ', hideHotkey: 'off' })).toEqual({
      'data-passback-hotkey': 'off',
      'data-passback-hide-hotkey': 'off',
    });
  });

  it('throws a plain message for a bad hideHotkey', () => {
    expect(() => widgetSettingAttrs({ hideHotkey: 'shift+h' })).toThrow(
      new Error(
        'passback: hideHotkey must be modifiers and one letter or digit joined by +, with alt, ctrl or meta among them, or off, got "shift+h"',
      ),
    );
  });
});

describe('isHotkey', () => {
  it('accepts every hotkey the widget accepts', () => {
    for (const text of ['alt+shift+m', 'ctrl+shift+k', 'ALT+2', ' Meta + Alt + x ']) {
      expect(isHotkey(text)).toBe(true);
    }
  });

  it('refuses every hotkey the widget falls back on', () => {
    const texts = ['', 'm', 'shift+m', 'alt+shift', 'alt+alt+m', 'alt+mm', 'alt++m', 'alt+', '+', 'm+alt', 'cmd+k', 'alt+f1'];
    for (const text of texts) expect(isHotkey(text)).toBe(false);
  });
});
