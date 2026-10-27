// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadShotOpen, type ShotOutcome, type ShotSession } from './shot-loader';
import type { SubmitDetail } from './overlay-submit';
import { createShotStep } from './shot-step';

vi.mock('./shot-loader', async (original) => ({
  ...(await original<typeof import('./shot-loader')>()),
  loadShotOpen: vi.fn(),
}));

const flush = () => new Promise((resolve) => setTimeout(resolve));
const detailOf = (comment: string): SubmitDetail => ({
  comment,
  selector: 'div',
  offset: { x: 1, y: 1 },
  element: document.createElement('div'),
});

async function setup(finish: ShotSession['finish'] | null) {
  document.head.innerHTML =
    '<script data-passback-screenshots="true" data-passback-endpoint="/e" data-passback-shot="/shot.js"></script>';
  const host = document.createElement('div');
  const root = host.attachShadow({ mode: 'open' });
  const made: ShotSession = { setActive: vi.fn(), count: () => 0, finish: finish!, close: vi.fn() };
  vi.mocked(loadShotOpen).mockResolvedValue(() => made);
  const step = createShotStep({ doc: document, win: window, root, host, onLoadFailed: vi.fn() });
  if (finish !== null) {
    host.dispatchEvent(new Event('passback:preload'));
    await flush();
  }
  return { step, made };
}

beforeEach(() => vi.resetAllMocks());

describe('shot step finishAll', () => {
  it('finishAll takes one picture for the batch and only the shapes for the other marks', async () => {
    const finish = vi.fn<ShotSession['finish']>(async (el): Promise<ShotOutcome> => ({
      note: el.tagName,
    }));
    const { step, made } = await setup(finish);
    const details = [detailOf('one'), detailOf('two')];
    const outcomes = await step.finishAll(details);
    expect(outcomes).toEqual([{ note: 'DIV' }, { note: 'DIV' }]);
    expect(finish.mock.calls).toEqual([
      [details[0]!.element, details[0]],
      [details[1]!.element, details[1], { picture: false }],
    ]);
    expect(made.close).toHaveBeenCalledOnce();
  });

  it('finishAll keeps going when one picture fails', async () => {
    const finish = vi
      .fn<ShotSession['finish']>()
      .mockResolvedValueOnce({ note: 'first' })
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ note: 'third' });
    const { step, made } = await setup(finish);
    const outcomes = await step.finishAll([detailOf('a'), detailOf('b'), detailOf('c')]);
    expect(outcomes).toEqual([
      { note: 'first' },
      { note: 'Screenshot not attached' },
      { note: 'third' },
    ]);
    expect(made.close).toHaveBeenCalledOnce();
  });

  it('finishAll without a session returns an empty outcome per detail', async () => {
    const { step } = await setup(null);
    expect(await step.finishAll([detailOf('a'), detailOf('b')])).toEqual([{}, {}]);
  });
});
