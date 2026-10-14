import type { Phase } from './phase';

export type FlowState = 'idle' | 'armed' | 'composing' | 'drawing' | 'sending' | 'hidden';
type Exit = 'cancel' | 'park' | 'reopen' | 'addMark' | 'hide' | 'show';
export type FlowEvent = 'arm' | 'pin' | 'drawOn' | 'drawOff' | 'send' | 'acked' | 'failed' | 'discard' | Exit;
// on/off switch drawing input, abandon cancels its session, settle keeps or drops the draft, drop deletes it unkept.
export type FlowEffect = 'on' | 'off' | 'abandon' | 'settle' | 'drop';
type Row = Partial<Record<FlowEvent, readonly [FlowState, ...FlowEffect[]]>>;

const DRAFT: Row = {
  cancel: ['idle', 'abandon', 'settle'],
  addMark: ['armed', 'abandon', 'settle'],
  hide: ['hidden', 'abandon'],
  discard: ['idle', 'abandon', 'drop'],
};
// park dismisses without settling: a full-list draft or a pending send waits for reopen.
const PARK = (at: FlowState): Row => ({ park: [at], reopen: [at] });
const OFF = ['composing', 'off'] as const;
// Every legal move as [next state, ...effects]; an event missing from a row is illegal there.
const TABLE: Record<FlowState, Row> = {
  idle: { arm: ['armed'], acked: ['idle'], hide: ['hidden'] },
  armed: { pin: ['composing'], cancel: ['idle'], hide: ['hidden'] },
  composing: { ...DRAFT, ...PARK('composing'), drawOn: ['drawing', 'on'], send: ['sending'] },
  drawing: { ...DRAFT, drawOff: OFF, send: ['sending', 'off'], park: OFF },
  sending: {
    ...PARK('sending'),
    send: ['sending'],
    acked: ['idle'],
    failed: ['sending'],
    hide: ['hidden'],
  },
  hidden: { show: ['idle'] },
};

export function transition(state: FlowState, event: FlowEvent) {
  const [next = state, ...effects] = TABLE[state][event] ?? [];
  return { state: next, effects, ok: TABLE[state][event] !== undefined };
}

export const phaseOf = (state: FlowState): Phase =>
  state === 'drawing' ? 'composing' : state === 'hidden' ? 'idle' : state;
