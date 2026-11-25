// The inbox file's status field and its legal transitions.

export const MARK_STATUSES = [
  'new',
  'ack',
  'proposed',
  'accepted',
  'verified',
  'declined',
  'withdrawn',
] as const;

export type MarkStatus = (typeof MARK_STATUSES)[number];

export type Actor = 'agent' | 'human' | 'widget';

type Move = { from: MarkStatus; to: MarkStatus; actor: Actor };

const LEGAL_MOVES: Move[] = [
  { from: 'new', to: 'ack', actor: 'agent' },
  { from: 'ack', to: 'proposed', actor: 'agent' },
  { from: 'proposed', to: 'verified', actor: 'widget' },
  { from: 'proposed', to: 'accepted', actor: 'human' },
  { from: 'verified', to: 'accepted', actor: 'human' },
];

/** Applies a status move; throws when `actor` may not move `status` to `to`. */
export function transition(status: MarkStatus, to: MarkStatus, actor: Actor): MarkStatus {
  if (actor === 'human' && to === 'withdrawn' && status !== 'withdrawn') {
    return 'withdrawn';
  }
  const legal = LEGAL_MOVES.some(
    (move) => move.from === status && move.to === to && move.actor === actor,
  );
  if (!legal) {
    throw new Error(`illegal transition: ${actor} cannot move '${status}' to '${to}'`);
  }
  return to;
}
