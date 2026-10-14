import { statusMotionRules } from './status-motion-styles';

function dotRule(): string {
  return `.pb-dot {
  position: absolute;
  display: grid;
  place-items: center;
  width: var(--pb-size-pin);
  height: var(--pb-size-pin);
  transform: translate(-50%, -50%);
  border-radius: var(--pb-radius-pin);
  background: var(--pb-color-main);
  color: var(--pb-color-on-main);
  box-shadow:
    0 0 0 2px var(--pb-color-on-main),
    0 0 0 3px var(--pb-color-halo),
    var(--pb-shadow-box);
  font: var(--pb-font-body);
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
}

.pb-dot svg {
  width: 12px;
  height: 12px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}`;
}

function dotStateRules(): string {
  return `.pb-dot[data-state="done"] {
  background: var(--pb-color-ok);
  color: var(--pb-color-on-status);
}

.pb-dot[data-state="failed"] {
  background: var(--pb-color-bad);
  color: var(--pb-color-on-status);
}

.pb-dot[data-state="orphaned"] {
  opacity: var(--pb-opacity-idle);
}`;
}

export function dotRules(): string {
  return [dotRule(), dotStateRules(), statusMotionRules()].join('\n\n');
}
