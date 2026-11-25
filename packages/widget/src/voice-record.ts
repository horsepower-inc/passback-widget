export const VOICE_MAX_MS = 120000;

const TICK_MS = 250;
const MIMES = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'];

export type VoiceStop = { blob: Blob; ms: number };
export type Recording = { mime: string; stop(): Promise<VoiceStop>; cancel(): void };

export type RecordEnv = {
  mediaDevices?: Pick<MediaDevices, 'getUserMedia'>;
  MediaRecorder?: typeof MediaRecorder;
  setInterval: (fn: () => void, ms: number) => unknown;
  clearInterval: (id: unknown) => void;
  now: () => number;
};

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export function pickMime(isSupported: (mime: string) => boolean): string | undefined {
  return MIMES.find((mime) => isSupported(mime));
}

function defaultEnv(): RecordEnv {
  return {
    mediaDevices: globalThis.navigator?.mediaDevices,
    MediaRecorder: globalThis.MediaRecorder,
    setInterval: (fn, ms) => globalThis.setInterval(fn, ms),
    clearInterval: (id) => globalThis.clearInterval(id as number),
    now: () => Date.now(),
  };
}

function watchLevel(
  stream: MediaStream,
  onLevel: (level: number) => void,
  env: RecordEnv,
): () => void {
  try {
    const Ctx = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
    if (!Ctx) return () => {};
    const ctx = new Ctx();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    const id = env.setInterval(() => {
      analyser.getByteTimeDomainData(data);
      let peak = 0;
      for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
      onLevel(Math.min(1, peak / 128));
    }, TICK_MS / 2);
    return () => {
      env.clearInterval(id);
      void ctx.close().catch(() => {});
    };
  } catch {
    return () => {};
  }
}

// Stopping releases the microphone even when the recorder is already done or throws.
function stopRecorder(recorder: MediaRecorder, stopTracks: () => void): void {
  try {
    if (recorder.state !== 'inactive') recorder.stop();
    else stopTracks();
  } catch {
    stopTracks();
  }
}

export async function startRecording(options: {
  onTick: (elapsedMs: number) => void;
  onLevel?: (level: number) => void;
  onLimit?: () => void;
  maxMs?: number;
  env?: Partial<RecordEnv>;
}): Promise<Recording> {
  const env: RecordEnv = { ...defaultEnv(), ...options.env };
  const maxMs = options.maxMs ?? VOICE_MAX_MS;
  const Recorder = env.MediaRecorder;
  if (!Recorder || !env.mediaDevices) throw new Error('unsupported');
  const mime = pickMime((m) => Recorder.isTypeSupported?.(m) ?? false);
  if (!mime) throw new Error('unsupported');

  let stream: MediaStream;
  try {
    stream = await env.mediaDevices.getUserMedia({ audio: true });
  } catch (error) {
    const name = (error as { name?: string } | null)?.name;
    throw new Error(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'failed');
  }
  const stopTracks = () => {
    for (const track of stream.getTracks()) track.stop();
  };

  let recorder: MediaRecorder;
  try {
    recorder = new Recorder(stream, { mimeType: mime });
  } catch {
    stopTracks();
    throw new Error('failed');
  }

  let chunks: Blob[] = [];
  let discard = false;
  // Cancelling drops the audio at once and keeps a late dataavailable from holding on to it.
  const discardData = () => {
    discard = true;
    chunks = [];
  };
  let result: Promise<VoiceStop> | undefined;

  let stopLevel = () => {};
  const startedAt = env.now();
  let elapsed = 0;

  const finished = new Promise<VoiceStop>((resolve) => {
    recorder.ondataavailable = (event: BlobEvent) => {
      if (!discard && event.data && event.data.size > 0) chunks.push(event.data);
    };
    recorder.onstop = () => {
      env.clearInterval(timer);
      stopLevel();
      stopTracks();
      const blob = new Blob(discard ? [] : chunks, { type: mime });
      chunks = [];
      recorder.ondataavailable = null;
      recorder.onstop = null;
      recorder.onerror = null;
      resolve({ blob, ms: elapsed });
    };
  });
  // A recorder that errors out still has to release the microphone.
  recorder.onerror = () => {
    discardData();
    stopRecorder(recorder, stopTracks);
  };

  const end = (): Promise<VoiceStop> => {
    if (!result) {
      elapsed = Math.min(env.now() - startedAt, maxMs);
      result = finished;
      stopRecorder(recorder, stopTracks);
    }
    return result;
  };

  try {
    recorder.start();
  } catch {
    stopTracks();
    throw new Error('failed');
  }
  if (options.onLevel) stopLevel = watchLevel(stream, options.onLevel, env);
  const timer = env.setInterval(() => {
    const now = Math.min(env.now() - startedAt, maxMs);
    if (!result) options.onTick(now);
    if (now < maxMs || result) return;
    void end();
    options.onLimit?.();
  }, TICK_MS);
  return {
    mime,
    stop: end,
    cancel() {
      discardData();
      void end();
    },
  };
}
