// The voice recording frame, level bars and chip, from --pb-* tokens only.
export function voiceMicStyles(): string {
  return `[data-role="voice-frame"] {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  gap: var(--pb-space-gap);
  color: var(--pb-color-text);
  font-size: var(--pb-font-small);
}

[data-role="voice-dot"] {
  width: var(--pb-space-gap);
  height: var(--pb-space-gap);
  border-radius: 50%;
  background: var(--pb-color-bad);
  animation: pb-voice-pulse 1s var(--pb-motion-ease) infinite;
}

[data-role="voice-bars"] {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  gap: 2px;
  height: var(--pb-space-pad);
}

[data-role="voice-bars"] i {
  flex: 1 1 0;
  min-height: 2px;
  height: 2px;
  border-radius: 1px;
  background: var(--pb-color-text-muted);
}

[data-role="voice-chip"] {
  display: inline-block;
  padding: 0 var(--pb-space-gap);
  border: thin solid var(--pb-color-border);
  border-radius: var(--pb-radius-control);
  color: var(--pb-color-text-muted);
  font-size: var(--pb-font-small);
}

@keyframes pb-voice-pulse {
  50% { opacity: var(--pb-opacity-idle); }
}

@media (prefers-reduced-motion: reduce) {
  [data-role="voice-dot"] { animation: none; }
}
`;
}
