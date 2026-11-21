export type CancelTimer = () => void;

export interface Clock {
  now(): number;
  setTimer(ms: number, cb: () => void): CancelTimer;
  sleep(ms: number): Promise<void>;
}
