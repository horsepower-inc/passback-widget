// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBubble } from './bubble-view';
import { renderAskBox } from './reply-box';
import { CLASS } from './styles';
import { voiceMic } from './voice-mic';
import type { Recording } from './voice-record';
import type { VoiceResult } from './voice-upload';

const scope = globalThis as { __passback?: unknown };
const MIC = '[data-role="voice"]';
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
// The probe answer is kept for the page, so every setup names its own relay.
let site = 0;

afterEach(() => {
  delete scope.__passback;
  document.head.innerHTML = '';
  document.body.innerHTML = '';
});

function setup(
  opts: { hot?: boolean; endpoint?: boolean; voice?: boolean; result?: VoiceResult } = {},
) {
  if (opts.hot) scope.__passback = { hot: {} };
  const endpoint = `https://relay.test/v1/ingest/site${++site}`;
  if (opts.endpoint !== false) {
    const script = document.head.appendChild(document.createElement('script'));
    script.setAttribute('data-passback-endpoint', endpoint);
  }
  const host = document.body.appendChild(document.createElement('div'));
  const root = host.attachShadow({ mode: 'open' });
  const onSend = vi.fn();
  const bubble = createBubble(root, { anchor: { x: 10, y: 10 }, onSend, onCancel: vi.fn() });
  renderAskBox(document, root.appendChild(document.createElement('div')), {
    question: 'Which one?',
    onSend: vi.fn(),
  });
  let onTick: (ms: number) => void = () => {};
  let onLimit: () => void = () => {};
  const recording: Recording = {
    mime: 'audio/webm',
    stop: vi.fn(async () => ({ blob: new Blob(['x']), ms: 12000 })),
    cancel: vi.fn(),
  };
  const probe = vi.fn(async () => opts.voice !== false);
  const record = vi.fn(async (o: { onTick: (ms: number) => void; onLimit?: () => void }) => {
    onTick = o.onTick;
    onLimit = o.onLimit ?? (() => {});
    return recording;
  });
  const upload = vi.fn(
    async () => opts.result ?? ({ ok: true, text: 'hello there' } as VoiceResult),
  );
  const run = () =>
    voiceMic({ root, host, doc: document }, { probe, record: record as never, upload });
  const ta = () => bubble.element.querySelector<HTMLTextAreaElement>('textarea')!;
  const q = <T extends Element>(sel: string) => root.querySelector<T>(sel);
  return {
    endpoint,
    onSend,
    ta,
    host,
    root,
    bubble,
    recording,
    probe,
    record,
    upload,
    run,
    q,
    tickTo: (ms: number) => onTick(ms),
    limit: () => onLimit(),
  };
}

async function speak(s: ReturnType<typeof setup>) {
  await s.run();
  s.q<HTMLButtonElement>(MIC)!.click();
  await tick();
}

describe('voice mic', () => {
  it('draws no mic on a local page or when the relay says voice is off', async () => {
    for (const opts of [{ hot: true }, { voice: false }, { endpoint: false }]) {
      const s = setup(opts);
      await s.run();
      expect(s.q(MIC)).toBeNull();
      expect(s.q('style[data-pb-voice-styles]')).toBeNull();
      document.head.innerHTML = '';
      delete scope.__passback;
    }
  });

  it('probes once per page and keeps a false answer for every later overlay', async () => {
    const s = setup({ voice: false });
    await s.run();
    s.probe.mockResolvedValue(true);
    await s.run();
    expect(s.probe).toHaveBeenCalledTimes(1);
    expect(s.q(MIC)).toBeNull();
  });

  it('starts one recording however often the mic is clicked while it waits', async () => {
    const s = setup();
    await s.run();
    let grant: (r: Recording) => void = () => {};
    s.record.mockImplementationOnce(() => new Promise<Recording>((r) => (grant = r)));
    const mic = s.q<HTMLButtonElement>(MIC)!;
    mic.click();
    mic.click();
    expect(mic.disabled).toBe(true);
    expect(s.record).toHaveBeenCalledTimes(1);
    grant(s.recording);
    await tick();
    expect(s.root.querySelectorAll('[data-role="voice-frame"]')).toHaveLength(1);
    s.q<HTMLButtonElement>('[data-role="voice-cancel"]')!.click();
    expect(s.recording.cancel).toHaveBeenCalledTimes(1);
  });

  it('stops live and pending recordings when the box or the host goes away', async () => {
    const s = setup();
    await speak(s);
    const keys = vi.spyOn(document, 'removeEventListener');
    s.bubble.destroy();
    await tick();
    expect(s.recording.cancel).toHaveBeenCalledTimes(1);
    expect(keys).toHaveBeenCalledWith('keydown', expect.any(Function), true);
    keys.mockRestore();

    const h = setup();
    await h.run();
    let grant: (r: Recording) => void = () => {};
    h.record.mockImplementationOnce(() => new Promise<Recording>((r) => (grant = r)));
    h.q<HTMLButtonElement>(MIC)!.click();
    h.host.dispatchEvent(new Event('passback:dispose'));
    grant(h.recording);
    await tick();
    expect(h.recording.cancel).toHaveBeenCalledTimes(1);
    expect(h.q('[data-role="voice-frame"]')).toBeNull();
  });

  it('adds the mic to a comment box on a hosted Premium site and not to the answer box', async () => {
    const s = setup();
    await s.run();
    expect(s.root.querySelectorAll(MIC)).toHaveLength(1);
    const mic = s.q<HTMLButtonElement>(MIC)!;
    expect(mic.type).toBe('button');
    expect(mic.className).toBe(CLASS.ico);
    expect(mic.getAttribute('aria-label')).toBe('Record a voice comment');
    expect(mic.querySelector('svg path')?.namespaceURI).toBe('http://www.w3.org/2000/svg');
    expect(mic.nextElementSibling?.classList.contains(CLASS.actions)).toBe(true);
    expect(s.probe).toHaveBeenCalledWith(`${s.endpoint}/voice`);
    expect(s.q('style[data-pb-voice-styles]')).not.toBeNull();
  });

  it('records, shows the clock and fills the textarea with the transcript', async () => {
    const s = await (async () => {
      const x = setup();
      await speak(x);
      return x;
    })();
    expect(s.q('[data-role="voice-dot"]')).not.toBeNull();
    expect(s.q('[data-role="voice-bars"]')!.children).toHaveLength(12);
    s.tickTo(7000);
    expect(s.q('[data-role="voice-clock"]')!.textContent).toBe('0:07');
    s.q<HTMLButtonElement>('[data-role="voice-stop"]')!.click();
    expect(s.q('[data-role="voice-clock"]')!.textContent).toBe('Transcribing');
    expect(s.q<HTMLButtonElement>('[data-role="voice-stop"]')!.disabled).toBe(true);
    await tick();
    expect(s.ta().value).toBe('hello there');
    expect(s.q('[data-role="voice-chip"]')!.textContent).toBe('Voice 0:12');
    expect(s.q('[data-role="voice-frame"]')).toBeNull();
    expect(s.upload).toHaveBeenCalledTimes(1);
  });

  it('appends to the text already typed and enables Send', async () => {
    const s = setup();
    s.ta().value = 'Button is off';
    await speak(s);
    s.q<HTMLButtonElement>('[data-role="voice-stop"]')!.click();
    await tick();
    expect(s.ta().value).toBe('Button is off hello there');
    s.ta().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(s.onSend).toHaveBeenCalledWith('Button is off hello there');
  });

  it('cancels a recording without uploading', async () => {
    const s = setup();
    await speak(s);
    s.q<HTMLButtonElement>('[data-role="voice-cancel"]')!.click();
    expect(s.recording.cancel).toHaveBeenCalled();
    expect(s.q('[data-role="voice-frame"]')).toBeNull();
    expect(s.q<HTMLElement>(MIC)!.hidden).toBe(false);
    await speak(s);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(s.q('[data-role="voice-frame"]')).toBeNull();
    expect(s.upload).not.toHaveBeenCalled();
  });

  it('shows the refusal line for plan_required, no_speech and a refused microphone', async () => {
    const a = setup({ result: { ok: false, code: 'plan_required' } });
    await speak(a);
    a.q<HTMLButtonElement>('[data-role="voice-stop"]')!.click();
    await tick();
    expect(a.q(`.${CLASS.note}[data-role="voice-note"]`)!.textContent).toBe(
      'Voice comments come with Premium.',
    );
    document.body.innerHTML = '';
    const b = setup({ result: { ok: false, code: 'no_speech' } });
    await speak(b);
    b.q<HTMLButtonElement>('[data-role="voice-stop"]')!.click();
    await tick();
    expect(b.q('[data-role="voice-note"]')!.textContent).toBe(
      'No words were heard. Try again or type.',
    );
    document.body.innerHTML = '';
    const c = setup();
    c.record.mockRejectedValueOnce(new Error('denied'));
    await speak(c);
    expect(c.q('[data-role="voice-note"]')!.textContent).toBe(
      'Microphone access was refused. Type the comment instead.',
    );
  });

  it('keeps the typed text when the upload fails', async () => {
    const s = setup({ result: { ok: false, code: 'failed' } });
    s.ta().value = 'typed';
    await speak(s);
    s.q<HTMLButtonElement>('[data-role="voice-stop"]')!.click();
    await tick();
    expect(s.ta().value).toBe('typed');
    expect(s.q('[data-role="voice-note"]')!.textContent).toBe(
      'Could not turn the recording into text. Type the comment instead.',
    );
  });

  it('finishes as on Stop when the recorder ends itself at the limit, and says so', async () => {
    const s = setup();
    s.recording.stop = vi.fn(async () => ({ blob: new Blob(['x']), ms: 120000 }));
    await speak(s);
    s.limit();
    expect(s.q('[data-role="voice-clock"]')!.textContent).toBe('Transcribing');
    expect(s.q<HTMLButtonElement>('[data-role="voice-stop"]')!.disabled).toBe(true);
    expect(s.q<HTMLButtonElement>('[data-role="voice-cancel"]')!.disabled).toBe(true);
    await tick();
    expect(s.upload).toHaveBeenCalledTimes(1);
    expect(s.q('[data-role="voice-frame"]')).toBeNull();
    expect(s.ta().value).toBe('hello there');
    expect(s.q('[data-role="voice-chip"]')!.textContent).toBe('Voice 2:00');
    expect(s.q('[data-role="voice-note"]')!.textContent).toBe(
      'Recording stopped at the 2:00 limit.',
    );
  });

  it('says the limit was reached in front of the refusal line when the upload fails', async () => {
    const s = setup({ result: { ok: false, code: 'no_speech' } });
    await speak(s);
    s.limit();
    await tick();
    expect(s.q('[data-role="voice-note"]')!.textContent).toBe(
      'Recording stopped at the 2:00 limit. No words were heard. Try again or type.',
    );
    expect(s.q('[data-role="voice-chip"]')).toBeNull();
  });

  it('uploads once when Stop and the limit meet, and drops the result on Escape', async () => {
    const s = setup();
    await speak(s);
    s.q<HTMLButtonElement>('[data-role="voice-stop"]')!.click();
    s.limit();
    await tick();
    s.limit();
    await tick();
    expect(s.recording.stop).toHaveBeenCalledTimes(1);
    expect(s.upload).toHaveBeenCalledTimes(1);
    expect(s.q('[data-role="voice-note"]')).toBeNull();
    expect(s.q('[data-role="voice-chip"]')!.textContent).toBe('Voice 0:12');

    const e = setup();
    await speak(e);
    e.limit();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await tick();
    expect(e.ta().value).toBe('');
    expect(e.q('[data-role="voice-chip"]')).toBeNull();
    expect(e.q('[data-role="voice-note"]')).toBeNull();
  });

  it('removes its observer on dispose', async () => {
    const disconnect = vi.spyOn(MutationObserver.prototype, 'disconnect');
    const s = setup();
    await s.run();
    s.host.dispatchEvent(new Event('passback:dispose'));
    expect(disconnect).toHaveBeenCalled();
    disconnect.mockRestore();
  });
});
