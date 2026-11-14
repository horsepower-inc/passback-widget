// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadShotOpen, type ShotOutcome, type ShotSession } from './shot-loader';
import { createOverlay, type Overlay, type SubmitDetail } from './overlay';
import { sendAll } from './send-all';
import { sendBatch, type SubmitAllDetail } from './send-batch';
import { createShotStep } from './shot-step';
import { CLASS } from './styles';
import { TRAY_CLASS } from './tray-view';

vi.mock('./shot-loader', async (original) => ({
  ...(await original<typeof import('./shot-loader')>()),
  loadShotOpen: vi.fn(),
}));

type Shot = NonNullable<ShotOutcome['screenshot']>;
const shot = (id: string) => ({ id }) as unknown as Shot;
const SHOT = shot('shot-1');
const REQUIRED = 'Screenshot required. Capture failed; retry to send.';
const flush = () => new Promise((resolve) => setTimeout(resolve));
const detailOf = (comment: string): SubmitDetail => ({
  comment,
  selector: 'div',
  offset: { x: 1, y: 1 },
  element: document.createElement('div'),
});
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
};

async function setup(finish: ShotSession['finish'] | null, preload = true) {
  document.head.innerHTML =
    '<script data-passback-screenshots="true" data-passback-endpoint="/e" data-passback-shot="/shot.js"></script>';
  const host = document.body.appendChild(document.createElement('div'));
  const root = host.attachShadow({ mode: 'open' });
  const made: ShotSession = { setActive: vi.fn(), count: () => 0, finish: finish!, close: vi.fn() };
  vi.mocked(loadShotOpen).mockResolvedValue(() => made);
  const step = createShotStep({ doc: document, win: window, root, host, onLoadFailed: vi.fn() });
  if (preload) {
    host.dispatchEvent(new Event('passback:preload'));
    await flush();
  }
  return { step, made, host, root };
}

const scope = globalThis as { __passback?: unknown };
let overlays: Overlay[] = [];
beforeEach(() => vi.resetAllMocks());
afterEach(() => {
  overlays.forEach((overlay) => overlay.destroy());
  overlays = [];
  delete scope.__passback;
  document.body.innerHTML = '';
});

describe('shot step finishAll', () => {
  it('finishAll takes one picture for the batch and only the shapes for the other marks', async () => {
    const finish = vi.fn<ShotSession['finish']>(async (el, _detail, opts): Promise<ShotOutcome> =>
      opts?.picture === false ? { note: el.tagName } : { screenshot: SHOT },
    );
    const { step, made } = await setup(finish);
    const details = [detailOf('one'), detailOf('two')];
    const outcomes = await step.finishAll(details);
    expect(outcomes).toEqual([{ screenshot: SHOT }, { note: 'DIV' }]);
    expect(finish.mock.calls).toEqual([
      [details[0]!.element, details[0]],
      [details[1]!.element, details[1], { picture: false }],
    ]);
    expect(made.close).toHaveBeenCalledOnce();
  });

  it('finishAll keeps going when a later mark fails and requires the first picture', async () => {
    const finish = vi
      .fn<ShotSession['finish']>()
      .mockResolvedValueOnce({ screenshot: SHOT, note: 'first' })
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ note: 'third' });
    const { step, made } = await setup(finish);
    const outcomes = await step.finishAll([detailOf('a'), detailOf('b'), detailOf('c')]);
    expect(outcomes).toEqual([
      { screenshot: SHOT, note: 'first' },
      { note: 'Screenshot not attached' },
      { note: 'third' },
    ]);
    expect(made.close).toHaveBeenCalledOnce();
    finish.mockResolvedValueOnce({ annotations: [] });
    await expect(step.finishAll([detailOf('d')])).rejects.toThrow(REQUIRED);
  });

  it('a late relay `screenshots: false` keeps the batch shapes for Retry', async () => {
    const answer = deferred<Response>();
    vi.spyOn(window, 'fetch').mockReturnValue(answer.promise);
    const first = deferred<ShotOutcome>();
    const shapes = [{ kind: 'box' }] as unknown as ShotOutcome['annotations'];
    const finish = vi.fn<ShotSession['finish']>(() => first.promise);
    const { step } = await setup(finish);
    const details = [detailOf('one')];
    const pending = step.finishAll(details);
    answer.resolve({ status: 200, json: async () => ({ screenshots: false }) } as Response);
    await flush();
    first.resolve({ annotations: shapes });
    await expect(pending).resolves.toEqual([{ annotations: shapes }]);
    await expect(step.finishAll(details)).resolves.toEqual([{ annotations: shapes }]);
    expect(finish).toHaveBeenCalledOnce();
    vi.mocked(window.fetch).mockRestore();
  });

  it('starts loading when finishing without preload', async () => {
    const finish = vi.fn<ShotSession['finish']>(async () => ({ screenshot: SHOT }));
    const { step } = await setup(finish, false);
    expect(loadShotOpen).not.toHaveBeenCalled();
    const details = [detailOf('a'), detailOf('b')];
    expect(await step.finishAll(details)).toHaveLength(2);
    expect(loadShotOpen).toHaveBeenCalledOnce();
    expect(finish).toHaveBeenCalledTimes(2);
    const single = await setup(finish, false);
    expect(await single.step.finish(details[0]!.element)).toEqual({ screenshot: SHOT });
  });

  it('blocks sends through fallback failure and permits capture Retry', async () => {
    const recovery = deferred<ShotOutcome>();
    const finish = vi
      .fn<ShotSession['finish']>()
      .mockReturnValueOnce(recovery.promise)
      .mockRejectedValueOnce(new Error('permission denied'))
      .mockResolvedValue({ screenshot: SHOT });
    const { step, made } = await setup(finish);
    const details = [detailOf('a'), detailOf('b')];
    const settled = vi.fn();
    const first = step.finishAll(details).then(settled, settled);
    await flush();
    expect(settled).not.toHaveBeenCalled();
    recovery.resolve({ note: 'Screenshot not attached' });
    await first;
    expect(settled).toHaveBeenCalledWith(expect.objectContaining({ message: REQUIRED }));
    expect(made.close).not.toHaveBeenCalled();
    await expect(step.finishAll(details)).rejects.toThrow(REQUIRED);
    expect(finish).toHaveBeenCalledTimes(2);
    const retried = await step.finishAll(details);
    expect(retried[0]).toEqual({ screenshot: SHOT });
    expect(finish).toHaveBeenCalledTimes(4);
    expect(made.close).toHaveBeenCalledOnce();
    await step.finishAll(details);
    expect(finish).toHaveBeenCalledTimes(4);
  });

  it('invalidates retained outcomes for replacement and close', async () => {
    const late = deferred<ShotOutcome>();
    const finish = vi.fn<ShotSession['finish']>(async () => ({ screenshot: SHOT }));
    const { step } = await setup(finish);
    const [a, b] = [[detailOf('a')], [detailOf('b')]];
    const first = await step.finishAll(a);
    expect(await step.finishAll(a)).toBe(first);
    expect(finish).toHaveBeenCalledOnce();
    await step.finishAll(b);
    expect(finish).toHaveBeenCalledTimes(2);
    await step.finishAll(a);
    expect(finish).toHaveBeenCalledTimes(3);
    step.close();
    await step.finishAll(a);
    expect(finish).toHaveBeenCalledTimes(4);
    // Pending work closed or replaced rejects, so its late picture is never sent.
    finish.mockReturnValueOnce(late.promise);
    const pending = step.finishAll(b);
    await flush();
    step.close();
    late.resolve({ screenshot: shot('late') });
    await expect(pending).rejects.toThrow(REQUIRED);
    expect(await step.finishAll(b)).toEqual([{ screenshot: SHOT }]);
    expect(finish).toHaveBeenCalledTimes(6);
    const replaced = deferred<ShotOutcome>();
    finish.mockReturnValueOnce(replaced.promise);
    const old = step.finishAll(a);
    await flush();
    expect(await step.finishAll(b)).toEqual([{ screenshot: SHOT }]);
    replaced.resolve({ screenshot: shot('replaced') });
    await expect(old).rejects.toThrow(REQUIRED);
    await step.finishAll(b);
    expect(finish).toHaveBeenCalledTimes(8);
    const element = document.createElement('p');
    await step.finish(element);
    await step.finish(element);
    expect(finish).toHaveBeenCalledTimes(9);
  });
});

describe('shot step with the real Send all', () => {
  it('retains one batch picture through the real Send all Retry', async () => {
    const [ink1, ink2] = [{ kind: 'box' }, { kind: 'arrow' }];
    let captures = 0;
    const finish = vi.fn<ShotSession['finish']>(async (_el, _detail, opts) =>
      opts?.picture === false
        ? ({ annotations: [ink2] } as unknown as ShotOutcome)
        : ({
            screenshot: shot(`shot-${++captures}`),
            annotations: [ink1],
          } as unknown as ShotOutcome),
    );
    scope.__passback = { fx: { addons: [sendAll] } };
    const { step, host, root } = await setup(finish);
    const overlay = createOverlay({
      doc: document,
      root,
      host,
      selectorOf: (el) => el.tagName.toLowerCase(),
      onSubmit: vi.fn(),
      drawing: { toggle: vi.fn(), cancel: vi.fn() },
    });
    overlays.push(overlay);
    const collector = { relay: true, sendBatch: vi.fn() };
    const gate = deferred<{ ok: true; ids: string[]; trimmed: boolean[] }>();
    collector.sendBatch
      .mockRejectedValueOnce(new Error('mark rejected'))
      .mockRejectedValueOnce(new Error('mark rejected again'))
      .mockReturnValueOnce(gate.promise)
      .mockResolvedValue({ ok: true, ids: ['t1'], trimmed: [false] });
    const loadCollector = deferred<typeof collector>();
    host.addEventListener('passback:submit-all', (event) => {
      const detail = (event as CustomEvent<SubmitAllDetail>).detail;
      void sendBatch(detail, () => loadCollector.promise, step);
    });
    overlay.arm();
    for (const text of ['one', 'two']) {
      document.body
        .appendChild(document.createElement('div'))
        .dispatchEvent(
          new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }),
        );
      const input = root.querySelector<HTMLTextAreaElement>(`.${CLASS.input}`)!;
      input.value = text;
      input.dispatchEvent(new Event('input'));
      root.querySelector<HTMLElement>('[data-role="add-more"]')!.click();
    }
    const retry = () =>
      [...root.querySelectorAll<HTMLElement>('button')].find((b) => b.textContent === 'Retry')!;
    const extras = (call: number) =>
      collector.sendBatch.mock.calls[call]![0].map((item: { extra?: unknown }) => item.extra);
    root.querySelector<HTMLElement>(`.${TRAY_CLASS.tray} .${CLASS.send}`)!.click();
    await flush();
    expect(collector.sendBatch).not.toHaveBeenCalled();
    loadCollector.resolve(collector);
    await flush();
    retry().click();
    await flush();
    expect(collector.sendBatch).toHaveBeenCalledTimes(2);
    expect(extras(1)).toEqual(extras(0));
    expect(extras(0)).toEqual([
      { screenshot: shot('shot-1'), annotations: [ink1] },
      { annotations: [ink2] },
    ]);
    expect(finish).toHaveBeenCalledTimes(2);
    // A changed batch captures again.
    root.querySelector<HTMLElement>('[aria-label="Delete comment 2"]')!.click();
    retry().click();
    await flush();
    expect(finish).toHaveBeenCalledTimes(3);
    expect(extras(2)).toEqual([{ screenshot: shot('shot-2'), annotations: [ink1] }]);
    expect(root.querySelectorAll('.pb-list li')).toHaveLength(1);
    gate.resolve({ ok: true, ids: ['t1'], trimmed: [false] });
    await flush();
    expect(root.querySelectorAll('.pb-list li')).toHaveLength(0);
  });
});
