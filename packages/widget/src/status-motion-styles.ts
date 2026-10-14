function ringRules(): string {
  return `.pb-dot[data-state="sending"]::after,
.pb-dot[data-state="running"]::after,
.pb-dot[data-state="queued"]::after {
  content: "";
  position: absolute;
  inset: -8px;
  border-radius: 50%;
  border: 2.5px solid transparent;
  border-top-color: var(--pb-color-accent);
  border-right-color: var(--pb-color-accent);
  animation: pb-spin var(--pb-motion-spin) linear infinite;
}

@keyframes pb-spin {
  to { transform: rotate(360deg); }
}`;
}

function sentRules(): string {
  return `.pb-dot[data-state="sent"] svg {
  animation: pb-pop var(--pb-motion-duration) var(--pb-motion-ease) 1;
}

@keyframes pb-pop {
  0% { transform: scale(0.5); }
  70% { transform: scale(1.25); }
  100% { transform: scale(1); }
}

.pb-bubble[data-state="sent"] .pb-note[data-role="sent"] {
  align-self: flex-start;
  padding: calc(var(--pb-space-gap) / 4) var(--pb-space-gap);
  border-radius: var(--pb-space-pad);
  background: var(--pb-color-ok);
  color: var(--pb-color-on-status);
  font-weight: 700;
}`;
}

function stampBlockRule(): string {
  return `.pb-stamp.pb-stamp {
  padding: calc(var(--pb-space-gap) / 4) var(--pb-space-gap);
  border-radius: 0;
  background: var(--pb-color-ok);
  color: var(--pb-color-on-status);
  text-shadow: none;
}`;
}

function reducedRules(): string {
  return `@media (prefers-reduced-motion: reduce) {
  .pb-dot[data-state="sent"] svg,
  .pb-dot[data-state]::after {
    animation: none;
  }
}`;
}

export function statusMotionRules(): string {
  return [ringRules(), sentRules(), stampBlockRule(), reducedRules()].join('\n\n');
}
