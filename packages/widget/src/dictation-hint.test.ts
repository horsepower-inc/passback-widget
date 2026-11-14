// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBubble } from './bubble-view';
import { dictationHint } from './dictation-hint';
import { renderAskBox } from './reply-box';
import { CLASS } from './styles';

const MAC = 'Press Fn twice to dictate. Nothing leaves your Mac.';
const WIN = 'Press Win+H to dictate.';
const scope = globalThis as { __passback?: unknown };
const nav = navigator as unknown as Record<string, unknown>;
const saved = { platform: Object.getOwnPropertyDescriptor(navigator, 'platform') };
const DOT = '[data-role="dictation"]';

afterEach(() => {
  delete scope.__passback;
  delete nav.userAgentData;
  if (saved.platform) Object.defineProperty(navigator, 'platform', saved.platform);
  else delete nav.platform;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

function platform(value: string | undefined, modern?: unknown): void {
  Object.defineProperty(navigator, 'platform', { value, configurable: true });
  if (modern !== undefined) {
    Object.defineProperty(navigator, 'userAgentData', {
      value: { platform: modern },
      configurable: true,
    });
  }
}

function setup(local = true) {
  if (local) scope.__passback = { hot: {} };
  const host = document.body.appendChild(document.createElement('div'));
  const root = host.attachShadow({ mode: 'open' });
  const onSend = vi.fn();
  const onCancel = vi.fn();
  const bubble = createBubble(root, { anchor: { x: 10, y: 10 }, onSend, onCancel });
  const answer = root.appendChild(document.createElement('div'));
  const onAnswer = vi.fn();
  renderAskBox(document, answer, { question: 'Which one?', onSend: onAnswer });
  const run = () => dictationHint({ root, host, doc: document });
  const comment = () => bubble.element.querySelector<HTMLTextAreaElement>('textarea')!;
  return { host, root, bubble, answer, onSend, onCancel, onAnswer, run, comment };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function check(text: string) {
  const { bubble, answer, run } = setup();
  run();
  const bar = bubble.element.querySelector(`.${CLASS.bar}`)!;
  const control = bar.querySelector(DOT)!;
  expect(control).toBe(bar.lastElementChild);
  expect(control.previousElementSibling?.classList.contains(CLASS.actions)).toBe(true);
  const note = control.querySelector('p')!;
  expect(note.className).toBe(CLASS.note);
  expect(note.textContent).toBe(text);
  expect(note.hidden).toBe(true);
  const button = control.querySelector<HTMLButtonElement>('[data-role="dictation-button"]')!;
  expect(button.type).toBe('button');
  expect(button.className).toBe(CLASS.ico);
  expect(button.getAttribute('aria-label')).toBe('Dictation help');
  expect(button.title).toBe(text);
  expect(button.getAttribute('aria-describedby')).toBe(note.id);
  const svg = button.querySelector('svg')!;
  expect(svg.getAttribute('viewBox')).toBe('0 0 16 16');
  expect(svg.getAttribute('aria-hidden')).toBe('true');
  const reply = answer.querySelector(DOT)!;
  expect(reply).toBe(answer.lastElementChild);
  expect(reply.previousElementSibling?.textContent).toBe('Answer');
  expect(reply.querySelector('p')?.textContent).toBe(text);
}

describe('dictation hint', () => {
  it('shows the macOS dictation hint in local comment and answer boxes', () => {
    platform('MacIntel');
    check(MAC);
  });

  it('shows the Windows dictation hint in local comment and answer boxes', () => {
    platform('Win32');
    check(WIN);
  });

  it('prefers userAgentData platform and falls back only when it is empty or absent', () => {
    platform('Win32', 'Android');
    let s = setup();
    s.run();
    expect(s.root.querySelector(DOT)).toBeNull();
    document.body.innerHTML = '';

    platform('Linux x86_64', 'macOS');
    s = setup();
    s.run();
    expect(s.root.querySelector('p[id^="pb-dictation"]')?.textContent).toBe(MAC);
    document.body.innerHTML = '';

    platform('Win64', '');
    s = setup();
    s.run();
    expect(s.root.querySelector('p[id^="pb-dictation"]')?.textContent).toBe(WIN);
    document.body.innerHTML = '';

    platform('MacIntel', 'Windows');
    s = setup();
    s.run();
    expect(s.root.querySelector('p[id^="pb-dictation"]')?.textContent).toBe(WIN);
  });

  it('omits dictation help for hosted mobile unsupported and missing browser contexts', async () => {
    platform('MacIntel');
    let s = setup(false);
    s.run();
    expect(s.root.querySelector(DOT)).toBeNull();
    s.root.appendChild(document.createElement('textarea')).className = CLASS.input;
    await tick();
    expect(s.root.querySelector(DOT)).toBeNull();

    for (const value of [
      'X11; Darwin arm64',
      'iPhone',
      'iPad',
      'Linux armv81',
      'Android',
      '',
      'Xwin',
    ]) {
      document.body.innerHTML = '';
      platform(value);
      s = setup();
      expect(() => s.run()).not.toThrow();
      expect(s.root.querySelector(DOT)).toBeNull();
    }

    document.body.innerHTML = '';
    platform(undefined);
    s = setup();
    expect(() => s.run()).not.toThrow();
    expect(s.root.querySelector(DOT)).toBeNull();

    const orphan = document.implementation.createHTMLDocument('x');
    const host = orphan.body.appendChild(orphan.createElement('div'));
    expect(() =>
      dictationHint({ root: host.attachShadow({ mode: 'open' }), host, doc: orphan }),
    ).not.toThrow();
  });

  it('reveals dictation help on hover focus and click without submitting or changing the draft', () => {
    platform('MacIntel');
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const store = vi.spyOn(Storage.prototype, 'setItem');
    const read = vi.spyOn(Storage.prototype, 'getItem');
    const media = { getUserMedia: vi.fn() };
    Object.defineProperty(navigator, 'mediaDevices', { value: media, configurable: true });
    const s = setup();
    s.run();
    const textarea = s.comment();
    textarea.value = 'hello world';
    textarea.dispatchEvent(new Event('input'));
    textarea.setSelectionRange(2, 7);
    const send = s.bubble.element.querySelector<HTMLButtonElement>(`.${CLASS.send}`)!;
    const sendDisabled = send.disabled;
    const control = s.bubble.element.querySelector(DOT)!;
    const button = control.querySelector('button')!;
    const note = control.querySelector('p')!;

    button.dispatchEvent(new Event('pointerenter'));
    expect(note.hidden).toBe(false);
    button.dispatchEvent(new Event('pointerleave'));
    expect(note.hidden).toBe(true);
    button.focus();
    expect(note.hidden).toBe(false);
    button.blur();
    expect(note.hidden).toBe(true);

    // happy-dom has no native Enter/Space activation; the control relies on it by being a plain
    // <button type="button"> with no key listener. The browser proof is in overlay-pin-comment.spec.ts.
    expect([button.localName, button.type]).toEqual(['button', 'button']);
    button.click();
    expect(note.hidden).toBe(false);
    button.dispatchEvent(new Event('pointerleave'));
    button.dispatchEvent(new Event('blur'));
    expect(note.hidden).toBe(false);
    expect(s.root.activeElement).toBe(textarea);
    expect(textarea.value).toBe('hello world');
    expect([textarea.selectionStart, textarea.selectionEnd]).toEqual([2, 7]);
    expect(send.disabled).toBe(sendDisabled);

    textarea.dispatchEvent(new Event('input'));
    expect(note.hidden).toBe(true);

    textarea.setSelectionRange(1, 6, 'backward');
    button.click();
    expect([textarea.selectionStart, textarea.selectionEnd]).toEqual([1, 6]);
    expect(textarea.selectionDirection).toBe('backward');

    expect(s.onSend).not.toHaveBeenCalled();
    expect(s.onCancel).not.toHaveBeenCalled();
    expect(s.onAnswer).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(store).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    expect(media.getUserMedia).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
    delete nav.mediaDevices;
  });

  it('keeps dictation help within the existing form lifecycle', async () => {
    platform('Win32');
    const s = setup();
    s.run();

    s.bubble.setPending();
    const bubbleControl = s.bubble.element.querySelector(DOT)!;
    const note = bubbleControl.querySelector('p')!;
    expect(s.comment().disabled).toBe(true);
    bubbleControl.querySelector('button')!.click();
    expect(note.hidden).toBe(true);

    s.answer.textContent = '';
    renderAskBox(document, s.answer, { question: 'Again?', onSend: s.onAnswer });
    expect(s.answer.querySelector(DOT)).toBeNull();
    await tick();
    expect(s.answer.querySelectorAll(DOT)).toHaveLength(1);
    expect(s.answer.lastElementChild?.matches(DOT)).toBe(true);

    s.answer.remove();
    expect(s.root.querySelectorAll(DOT)).toHaveLength(1);
    s.bubble.destroy();
    await tick();
    expect(s.root.querySelectorAll(DOT)).toHaveLength(0);

    s.host.dispatchEvent(new Event('passback:dispose'));
    const late = s.root.appendChild(document.createElement('div'));
    renderAskBox(document, late, { question: 'Late?', onSend: s.onAnswer });
    await tick();
    expect(late.querySelector(DOT)).toBeNull();
  });
});
