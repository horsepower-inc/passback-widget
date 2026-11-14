import { describe, expect, it, vi } from 'vitest';
import {
  formatClock,
  pickMime,
  startRecording,
  VOICE_MAX_MS,
  type RecordEnv,
} from './voice-record';

function setup(
  opts: {
    supported?: (m: string) => boolean;
    reject?: unknown;
    startThrows?: boolean;
    deferStop?: boolean;
  } = {},
) {
  let clock = 0;
  let closing: (() => void) | undefined;
  let tick: (() => void) | undefined;
  const track = { stop: vi.fn() };
  const stream = { getTracks: () => [track] };

  class FakeRecorder {
    static last: FakeRecorder | undefined;
    static isTypeSupported = opts.supported ?? (() => true);
    state = 'inactive';
    ondataavailable?: ((e: { data: Blob }) => void) | null;
    onstop?: (() => void) | null;
    onerror?: (() => void) | null;
    constructor(
      public stream: unknown,
      public options: { mimeType: string },
    ) {
      FakeRecorder.last = this;
    }
    start() {
      if (opts.startThrows) throw Object.assign(new Error('x'), { name: 'NotSupportedError' });
      this.state = 'recording';
    }
    stop() {
      this.state = 'inactive';
      const close = () => {
        this.ondataavailable?.({ data: new Blob(['abc']) });
        this.onstop?.();
      };
      // A real recorder fires stop later, so the interval keeps ticking while it closes.
      if (opts.deferStop) closing = close;
      else close();
    }
  }
  const env = {
    mediaDevices: {
      getUserMedia: vi.fn(async () => {
        if (opts.reject) throw opts.reject;
        return stream;
      }),
    },
    MediaRecorder: FakeRecorder,
    setInterval: (fn: () => void) => {
      tick = fn;
      return 1;
    },
    clearInterval: () => {
      tick = undefined;
    },
    now: () => clock,
  } as unknown as RecordEnv;
  return {
    env,
    track,
    recorder: () => FakeRecorder.last,
    advance(ms: number) {
      clock += ms;
      tick?.();
    },
    close() {
      closing?.();
      closing = undefined;
    },
  };
}

describe('voice record', () => {
  it('picks the first supported mime type', () => {
    expect(pickMime(() => true)).toBe('audio/webm;codecs=opus');
    expect(pickMime((m) => m !== 'audio/webm;codecs=opus')).toBe('audio/ogg;codecs=opus');
    expect(pickMime((m) => m === 'audio/mp4')).toBe('audio/mp4');
    expect(pickMime(() => false)).toBeUndefined();
  });

  it('formats the clock as minutes and seconds', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(12999)).toBe('0:12');
    expect(formatClock(65000)).toBe('1:05');
    expect(formatClock(VOICE_MAX_MS)).toBe('2:00');
  });

  it('ticks while recording and returns the blob on stop', async () => {
    const s = setup();
    const ticks: number[] = [];
    const rec = await startRecording({ onTick: (ms) => ticks.push(ms), env: s.env });
    expect(rec.mime).toBe('audio/webm;codecs=opus');
    s.advance(250);
    s.advance(250);
    expect(ticks).toEqual([250, 500]);
    const out = await rec.stop();
    expect(out.ms).toBe(500);
    expect(out.blob.size).toBe(3);
    expect(out.blob.type).toBe('audio/webm;codecs=opus');
    expect(s.track.stop).toHaveBeenCalled();
  });

  it('stops by itself at the maximum length', async () => {
    const s = setup();
    const rec = await startRecording({ onTick: () => {}, maxMs: 1000, env: s.env });
    s.advance(1000);
    expect(s.recorder()?.state).toBe('inactive');
    expect(s.track.stop).toHaveBeenCalled();
    const first = await rec.stop();
    const second = await rec.stop();
    expect(first.ms).toBe(1000);
    expect(second).toBe(first);
  });

  it('tells the caller once when it ends itself at the maximum length, and not after stop or cancel', async () => {
    const s = setup({ deferStop: true });
    const onLimit = vi.fn();
    const rec = await startRecording({ onTick: () => {}, onLimit, maxMs: 1000, env: s.env });
    s.advance(500);
    expect(onLimit).not.toHaveBeenCalled();
    s.advance(500);
    expect(onLimit).toHaveBeenCalledTimes(1);
    s.advance(250);
    s.advance(250);
    expect(onLimit).toHaveBeenCalledTimes(1);
    s.close();
    expect((await rec.stop()).ms).toBe(1000);

    const stopped = setup({ deferStop: true });
    const afterStop = vi.fn();
    const a = await startRecording({
      onTick: () => {},
      onLimit: afterStop,
      maxMs: 1000,
      env: stopped.env,
    });
    const ending = a.stop();
    stopped.advance(1000);
    stopped.advance(250);
    stopped.close();
    await ending;
    expect(afterStop).not.toHaveBeenCalled();

    const cancelled = setup({ deferStop: true });
    const afterCancel = vi.fn();
    const b = await startRecording({
      onTick: () => {},
      onLimit: afterCancel,
      maxMs: 1000,
      env: cancelled.env,
    });
    b.cancel();
    cancelled.advance(1000);
    cancelled.close();
    cancelled.advance(250);
    expect(afterCancel).not.toHaveBeenCalled();
  });

  it('discards the data and stops the tracks on cancel', async () => {
    const s = setup();
    const rec = await startRecording({ onTick: () => {}, env: s.env });
    rec.cancel();
    expect(s.track.stop).toHaveBeenCalled();
    expect((await rec.stop()).blob.size).toBe(0);
    expect(s.recorder()?.ondataavailable).toBeNull();
    expect(s.recorder()?.onstop).toBeNull();
  });

  it('rejects with failed and stops the tracks when the recorder cannot start', async () => {
    const s = setup({ startThrows: true });
    await expect(startRecording({ onTick: () => {}, env: s.env })).rejects.toThrow(/^failed$/);
    expect(s.track.stop).toHaveBeenCalled();
  });

  it('rejects with denied when the microphone is refused', async () => {
    const s = setup({ reject: Object.assign(new Error('x'), { name: 'NotAllowedError' }) });
    await expect(startRecording({ onTick: () => {}, env: s.env })).rejects.toThrow('denied');
    const other = setup({ reject: new Error('busy') });
    await expect(startRecording({ onTick: () => {}, env: other.env })).rejects.toThrow('failed');
  });

  it('rejects with unsupported without a recorder or a supported type', async () => {
    const s = setup();
    await expect(
      startRecording({ onTick: () => {}, env: { ...s.env, MediaRecorder: undefined } }),
    ).rejects.toThrow('unsupported');
    const none = setup({ supported: () => false });
    await expect(startRecording({ onTick: () => {}, env: none.env })).rejects.toThrow(
      'unsupported',
    );
  });
});
