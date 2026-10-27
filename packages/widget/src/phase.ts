export type Phase = 'idle' | 'armed' | 'composing' | 'sending';

// The host element shows the phase so a page can react to it (the landing demo does).
export const PHASE_ATTRIBUTE = 'data-passback-phase';

export function enterPhase(state: { phase: Phase }, host: HTMLElement, phase: Phase): void {
  state.phase = phase;
  host.setAttribute(PHASE_ATTRIBUTE, phase);
}
