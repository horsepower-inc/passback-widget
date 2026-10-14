// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResolveTarget } from '@passback/collectors';
import type { SendResult } from './send';
import type { ShotOpen, ShotOutcome } from './shot-loader';
import { HOST_ATTRIBUTE } from './mount';
import { CLASS } from './styles';
import { armWidget } from './test-arm';
import type { Widget } from './index';

type Passback = { autoStart: boolean; collect?: unknown; shot?: unknown };

const SHOT = { id: 'shot-1' } as unknown as NonNullable<ShotOutcome['screenshot']>;
const SHAPES = [{ kind: 'box' }] as unknown as NonNullable<ShotOutcome['annotations']>;

function setPassback(value: Passback): void {
  (window as unknown as { __passback?: Passback }).__passback = value;
}

function addScript(attrs: Record<string, string>): void {
  const script = document.createElement('script');
  for (const [k, v] of Object.entries(attrs)) script.setAttribute(k, v);
  document.head.appendChild(script);
}

const OPTED_IN = {
  'data-passback-endpoint': '/__passback/mark',
  'data-passback-shot': '/shot.js',
  'data-passback-screenshots': 'true',
};

type Session = {
  setActive: ReturnType<typeof vi.fn<(on: boolean) => void>>;
  count: ReturnType<typeof vi.fn<() => number>>;
  finish: ReturnType<typeof vi.fn<(el: Element) => Promise<ShotOutcome>>>;
  close: ReturnType<typeof vi.fn<() => void>>;
};

function fakeSession(count: number, outcome: ShotOutcome): Session {
  return {
    setActive: vi.fn(),
    count: vi.fn(() => count),
    finish: vi.fn(async () => outcome),
    close: vi.fn(),
  };
}

function fakeCollector(log: string[] = []) {
  return {
    send: vi.fn(async (): Promise<SendResult> => {
      log.push('send');
      return { ok: true, id: 'abc', trimmed: false };
    }),
    selectorOf: vi.fn(() => '#save'),
    targetOf: vi.fn(() => ({ selectors: [], tag: 'div', text: '' }) as ResolveTarget),
    reresolve: vi.fn(() => null),
    dispose: vi.fn(),
  };
}

let widgets: Widget[] = [];

async function startWidget(): Promise<ShadowRoot> {
  const { start } = await import('./index');
  widgets.push(start());
  return document.querySelector<HTMLElement>(`[${HOST_ATTRIBUTE}]`)!.shadowRoot!;
}

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

function compose(root: ShadowRoot, comment: string): Element {
  armWidget(root);
  const target = document.createElement('div');
  target.id = 'save';
  document.body.appendChild(target);
  target.getBoundingClientRect = () =>
    ({ left: 10, top: 20, right: 0, bottom: 0, width: 0, height: 0, x: 10, y: 20 }) as DOMRect;
  target.dispatchEvent(
    new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: 15,
      clientY: 27,
    }),
  );
  const textarea = root.querySelector<HTMLTextAreaElement>(`.${CLASS.input}`)!;
  textarea.value = comment;
  textarea.dispatchEvent(new Event('input'));
  return target;
}

function pressEnter(root: ShadowRoot): void {
  root
    .querySelector<HTMLTextAreaElement>(`.${CLASS.input}`)!
    .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
}

const pencil = (root: ShadowRoot) => root.querySelector<HTMLButtonElement>('[data-role="draw"]');

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  widgets.forEach((widget) => widget.stop());
  widgets = [];
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  delete (window as unknown as { __passback?: Passback }).__passback;
  vi.restoreAllMocks();
});

describe('widget drawing wiring', () => {
  it('shows no pencil and requests no chunk when the page did not opt in', async () => {
    const append = vi.spyOn(document.head, 'appendChild');
    setPassback({ autoStart: false, collect: () => fakeCollector() });
    const root = await startWidget();
    compose(root, 'hi');
    await settle();
    expect(pencil(root)).toBeNull();
    expect(append).not.toHaveBeenCalled();
  });

  it('shows the pencil when the script tag has the endpoint, the shot chunk and screenshots true', async () => {
    addScript(OPTED_IN);
    setPassback({ autoStart: false, collect: () => fakeCollector() });
    const root = await startWidget();
    compose(root, 'hi');
    expect(pencil(root)).not.toBeNull();
  });

  it('opens a session on the first press of the pencil and pauses it on the second', async () => {
    addScript(OPTED_IN);
    const session = fakeSession(0, {});
    const open = vi.fn<ShotOpen>(() => session);
    setPassback({ autoStart: false, collect: () => fakeCollector(), shot: open });
    const root = await startWidget();
    compose(root, 'hi');
    pencil(root)!.click();
    await settle();
    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0]![0].uploadUrl).toBe('/__passback/mark/screenshots');
    pencil(root)!.click();
    expect(session.setActive).toHaveBeenCalledWith(false);
  });

  it('un-presses the pencil when the chunk cannot be loaded', async () => {
    addScript(OPTED_IN);
    setPassback({ autoStart: false, collect: () => fakeCollector() });
    const loading: HTMLScriptElement[] = [];
    const root = await startWidget();
    compose(root, 'hi');
    vi.spyOn(document.head, 'appendChild').mockImplementation(((node: Node) => {
      loading.push(node as HTMLScriptElement);
      return node;
    }) as typeof document.head.appendChild);
    pencil(root)!.click();
    expect(pencil(root)!.getAttribute('aria-pressed')).toBe('true');
    loading[0]!.dispatchEvent(new Event('error'));
    await settle();
    expect(pencil(root)!.getAttribute('aria-pressed')).toBe('false');
  });

  it('sends the comment with no picture and no capture when nothing was drawn', async () => {
    addScript(OPTED_IN);
    const session = fakeSession(0, { screenshot: SHOT });
    const collector = fakeCollector();
    setPassback({ autoStart: false, collect: () => collector, shot: () => session });
    const root = await startWidget();
    const target = compose(root, 'plain');
    pencil(root)!.click();
    await settle();
    pressEnter(root);
    await settle();
    expect(session.finish).not.toHaveBeenCalled();
    expect(session.close).toHaveBeenCalledTimes(1);
    expect(collector.send).toHaveBeenCalledWith(target, 'plain');
  });

  it('finishes the session before loading the collector and sends the screenshot and the annotations with the mark', async () => {
    addScript(OPTED_IN);
    const log: string[] = [];
    const session = fakeSession(2, { screenshot: SHOT, annotations: SHAPES });
    session.finish.mockImplementation(async () => {
      log.push('finish');
      return { screenshot: SHOT, annotations: SHAPES };
    });
    const collector = fakeCollector(log);
    setPassback({
      autoStart: false,
      collect: () => {
        log.push('collector');
        return collector;
      },
      shot: () => session,
    });
    const root = await startWidget();
    const target = compose(root, 'drawn');
    pencil(root)!.click();
    await settle();
    const before = log.length;
    pressEnter(root);
    await settle();
    expect(log.slice(before)).toEqual(['finish', 'send']);
    expect(collector.send).toHaveBeenCalledWith(target, 'drawn', {
      screenshot: SHOT,
      annotations: SHAPES,
    });
  });

  it('sends the mark without a picture and shows Screenshot not attached when the session returns a note', async () => {
    addScript(OPTED_IN);
    const session = fakeSession(1, { note: 'Screenshot not attached', annotations: [] });
    session.close.mockImplementation(() => {
      throw new Error('close failed');
    });
    const collector = fakeCollector();
    setPassback({ autoStart: false, collect: () => collector, shot: () => session });
    const root = await startWidget();
    const target = compose(root, 'drawn');
    pencil(root)!.click();
    await settle();
    pressEnter(root);
    await settle();
    expect(collector.send).toHaveBeenCalledWith(target, 'drawn');
    expect(collector.send.mock.calls[0]).toHaveLength(2);
    expect(root.querySelector(`.${CLASS.bubble}`)!.textContent).toContain(
      'Screenshot not attached',
    );
  });

  it('closes the session when the comment box is cancelled and when the widget stops', async () => {
    addScript(OPTED_IN);
    const first = fakeSession(1, {});
    const second = fakeSession(1, {});
    const sessions = [first, second];
    setPassback({ autoStart: false, collect: () => fakeCollector(), shot: () => sessions.shift() });
    const root = await startWidget();
    compose(root, 'hi');
    pencil(root)!.click();
    await settle();
    root
      .querySelector<HTMLTextAreaElement>(`.${CLASS.input}`)!
      .dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      );
    await settle();
    expect(first.close).toHaveBeenCalled();
    expect(first.finish).not.toHaveBeenCalled();
    compose(root, 'again');
    pencil(root)!.click();
    await settle();
    widgets[0]!.stop();
    expect(second.close).toHaveBeenCalledTimes(1);
  });

  it('does not finish a session again on retry', async () => {
    addScript(OPTED_IN);
    const session = fakeSession(1, { screenshot: SHOT });
    const collector = fakeCollector();
    collector.send.mockResolvedValueOnce({ ok: false, reason: 'rejected', message: 'nope' });
    setPassback({ autoStart: false, collect: () => collector, shot: () => session });
    const root = await startWidget();
    const target = compose(root, 'drawn');
    pencil(root)!.click();
    await settle();
    pressEnter(root);
    await settle();
    const retry = [...root.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent === 'Retry',
    )!;
    retry.click();
    await settle();
    expect(session.finish).toHaveBeenCalledTimes(1);
    expect(collector.send).toHaveBeenCalledTimes(2);
    expect(collector.send).toHaveBeenLastCalledWith(target, 'drawn');
  });
});
