import { dotRules } from './dot-styles';
import { stampRules } from './stamp';
import { DEFAULT_SCHEME, SCHEMES, TOKENS } from './tokens';

export const CLASS = {
  launcher: 'pb-launcher',
  dot: 'pb-dot',
  outline: 'pb-outline',
  hint: 'pb-hint',
  bubble: 'pb-bubble',
  input: 'pb-input',
  send: 'pb-send',
  note: 'pb-note',
  count: 'pb-count',
  bar: 'pb-bar',
  ico: 'pb-ico',
  actions: 'pb-actions',
} as const;

export const SCHEME_ATTRIBUTE = 'data-pb-scheme';

const STYLE_ATTRIBUTE = 'data-pb-styles';

function declarations(entries: Readonly<Record<string, string>>): string {
  return Object.entries(entries)
    .map(([name, value]) => `  ${name}: ${value};`)
    .join('\n');
}

function hostRule(): string {
  return `:host {
${declarations(TOKENS)}
${declarations(SCHEMES[DEFAULT_SCHEME])}
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: var(--pb-z);
}

:host([${SCHEME_ATTRIBUTE}="light"]) {
${declarations(SCHEMES.light)}
}`;
}

function launcherRules(): string {
  return `.${CLASS.launcher} {
  position: fixed;
  right: calc(var(--pb-space-gap) * 1.5);
  bottom: calc(var(--pb-space-gap) * 1.5);
  width: var(--pb-size-launcher);
  height: var(--pb-size-launcher);
  display: grid;
  place-items: center;
  padding: 0;
  border: thin solid var(--pb-color-border);
  border-radius: var(--pb-radius-pin);
  background: var(--pb-color-surface);
  color: var(--pb-color-text);
  font: var(--pb-font-body);
  box-shadow: var(--pb-shadow-box);
  opacity: var(--pb-opacity-idle);
  pointer-events: auto;
  cursor: pointer;
  transition: opacity var(--pb-motion-duration) var(--pb-motion-ease);
}

.${CLASS.launcher}[hidden], .${CLASS.count}[hidden] { display: none; }

.${CLASS.launcher} svg { grid-area: 1 / 1; }
.${CLASS.launcher} .pb-ball { transform: none; opacity: 1; transition: transform 800ms cubic-bezier(0.34, 1.56, 0.64, 1) 60ms, opacity 160ms ease-out 40ms; }
.${CLASS.launcher} .pb-cross { transform: rotate(-180deg) scale(0.3); opacity: 0; transition: transform 120ms ease-in, opacity 120ms ease-in; }
.${CLASS.launcher}[data-open] .pb-ball { transform: rotate(720deg) scale(0.3); opacity: 0; transition: transform 350ms cubic-bezier(0.5, 0, 0.3, 1), opacity 200ms ease-in; }
.${CLASS.launcher}[data-open] .pb-cross { transform: none; opacity: 1; transition: transform 350ms cubic-bezier(0.5, 0, 0.3, 1), opacity 220ms ease-out 40ms; }

.${CLASS.launcher}:hover, .${CLASS.launcher}:focus-visible { opacity: 1; }`;
}

function badgeRules(): string {
  return `.${CLASS.launcher}[data-corner='bottom-left'] { right: auto; left: calc(var(--pb-space-gap) * 1.5); }
.${CLASS.launcher}[data-corner='top-right'] { bottom: auto; top: calc(var(--pb-space-gap) * 1.5); }
.${CLASS.launcher}[data-corner='top-left'] {
  right: auto;
  bottom: auto;
  left: calc(var(--pb-space-gap) * 1.5);
  top: calc(var(--pb-space-gap) * 1.5);
}

.${CLASS.count} {
  position: absolute;
  top: calc(var(--pb-space-gap) * -0.75);
  right: calc(var(--pb-space-gap) * -0.75);
  min-width: calc(var(--pb-space-gap) * 2);
  height: calc(var(--pb-space-gap) * 2);
  padding: 0 calc(var(--pb-space-gap) / 2);
  border-radius: var(--pb-space-gap);
  background: var(--pb-color-main);
  color: var(--pb-color-on-main);
  font-size: 0.77em;
  font-weight: 600;
  line-height: calc(var(--pb-space-gap) * 2);
  text-align: center;
}`;
}

function outlineRule(): string {
  return `.${CLASS.outline} {
  position: absolute;
  border-radius: var(--pb-radius-control);
  outline: 2px solid var(--pb-color-accent);
  outline-offset: 2px;
}`;
}

function hintRule(): string {
  return `.${CLASS.hint} {
  position: absolute;
  left: 50%;
  top: 10px;
  transform: translateX(-50%);
  max-width: calc(100% - 24px);
  padding: 6px 10px;
  border: 1px solid var(--pb-color-border);
  border-radius: var(--pb-radius-control);
  background: var(--pb-color-surface);
  color: var(--pb-color-text);
  box-shadow: var(--pb-shadow-box);
  font: var(--pb-font-body);
  font-size: var(--pb-font-small);
  white-space: nowrap;
}
.${CLASS.hint}[data-corner^='top'] {
  top: auto;
  bottom: 10px;
}`;
}

function bubbleRule(): string {
  return `.${CLASS.bubble} {
  position: absolute;
  display: flex;
  flex-direction: column;
  gap: var(--pb-space-gap);
  width: var(--pb-size-box);
  padding: var(--pb-space-pad);
  border-radius: var(--pb-radius-box);
  background: var(--pb-color-surface);
  color: var(--pb-color-text);
  font: var(--pb-font-body);
  box-shadow: var(--pb-shadow-box);
  pointer-events: auto;
  transition:
    opacity var(--pb-motion-duration) var(--pb-motion-ease),
    transform var(--pb-motion-duration) var(--pb-motion-ease);
}`;
}

function inputRule(): string {
  return `.${CLASS.input} {
  font: var(--pb-font-body);
  color: var(--pb-color-text);
  background: var(--pb-color-field);
  border: var(--pb-color-border) solid;
  border-radius: var(--pb-radius-control);
  pointer-events: auto;
  transition: border-color var(--pb-motion-duration) var(--pb-motion-ease);
}`;
}

function sendRule(): string {
  return `.${CLASS.send} {
  font: var(--pb-font-body);
  color: var(--pb-color-on-main);
  background: var(--pb-color-main);
  border: none;
  border-radius: var(--pb-radius-control);
  cursor: pointer;
  pointer-events: auto;
  transition: background-color var(--pb-motion-duration) var(--pb-motion-ease);
}`;
}

function noteRule(): string {
  return `.${CLASS.note} {
  font: var(--pb-font-body);
  font-size: var(--pb-font-small);
  color: var(--pb-color-text-muted);
}`;
}

function barRules(): string {
  const { bar, ico, note, bubble, actions, send } = CLASS;
  return [
    `.${actions} { display: flex; align-items: center; gap: var(--pb-space-gap); margin-left: auto; }`,
    `.${actions} > .${ico}, .${actions} > .${send} { box-sizing: border-box; height: 30px; width: auto; padding: 0 var(--pb-space-pad); border-radius: var(--pb-radius-control); font: var(--pb-font-body); white-space: nowrap; }`,
    `.${actions} > .${send} { border: thin solid var(--pb-color-main); }`,
    `.${bar} { display: flex; flex-wrap: nowrap; align-items: center; gap: var(--pb-space-gap); }`,
    `.${bar} > .${note} { margin-right: auto; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }`,
    `.${bar} > button { flex: none; }`,
    `.${ico} { width: 30px; height: 30px; padding: 0; display: grid; place-items: center; border: thin solid var(--pb-color-border); border-radius: var(--pb-radius-control); background: transparent; color: var(--pb-color-text); cursor: pointer; pointer-events: auto; }`,
    `.${ico}[data-wide] { width: auto; padding: 0 var(--pb-space-pad); font: var(--pb-font-body); }`,
    `.${ico}:disabled { opacity: var(--pb-opacity-idle); cursor: default; }`,
    `.${ico} svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }`,
    `.${bubble}[data-docked] { position: fixed; left: calc(var(--pb-space-gap) * 1.5); right: calc(var(--pb-space-gap) * 1.5); top: auto; bottom: calc(var(--pb-size-launcher) + var(--pb-space-gap) * 3); width: auto; max-width: none; }`,
  ].join('\n');
}

function reducedMotionRule(): string {
  return `@media (prefers-reduced-motion: reduce) {
  .${CLASS.launcher},
  .${CLASS.count},
  .${CLASS.dot},
  .${CLASS.outline},
  .${CLASS.hint},
  .${CLASS.bubble},
  .${CLASS.input},
  .${CLASS.send},
  .${CLASS.note},
  .${CLASS.bar},
  .${CLASS.ico},
  .${CLASS.launcher} svg,
  .${CLASS.launcher}[data-open] svg {
    transition: none;
    animation: none;
  }

  .${CLASS.dot}[data-state] svg,
  .${CLASS.dot}[data-state]::after {
    animation: none;
  }
}`;
}

export function styleSheet(): string {
  return (
    [
      hostRule(),
      launcherRules(),
      badgeRules(),
      dotRules(),
      outlineRule(),
      hintRule(),
      bubbleRule(),
      inputRule(),
      sendRule(),
      noteRule(),
      stampRules(),
      barRules(),
      reducedMotionRule(),
    ].join('\n\n') + '\n'
  );
}

export function installStyles(root: ShadowRoot, doc: Document = document): HTMLStyleElement {
  const existing = root.querySelector<HTMLStyleElement>(`style[${STYLE_ATTRIBUTE}]`);
  if (existing) return existing;

  const style = doc.createElement('style');
  style.setAttribute(STYLE_ATTRIBUTE, '');
  style.textContent = styleSheet();
  root.appendChild(style);
  return style;
}
