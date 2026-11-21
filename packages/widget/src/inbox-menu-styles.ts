// The ⋯ menu, its status bar and the Clear workspace dialog, from --pb-* tokens only.
function popupRules(): string {
  return `.pb-cm {
  position: absolute;
  right: var(--pb-space-pad);
  z-index: 1;
  display: flex;
  flex-direction: column;
  min-width: 200px;
  padding: var(--pb-space-gap);
  background: var(--pb-color-surface);
  border: thin solid var(--pb-color-border);
  border-radius: var(--pb-radius-box);
  box-shadow: var(--pb-shadow-box);
}

.pb-cm-item {
  display: flex;
  justify-content: space-between;
  gap: var(--pb-space-pad);
  padding: var(--pb-space-gap);
  border: 0;
  border-radius: var(--pb-radius-control);
  background: transparent;
  color: var(--pb-color-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.pb-cm-item:disabled {
  color: var(--pb-color-text-muted);
  cursor: default;
}

.pb-cm-item[data-danger]:not(:disabled) {
  color: var(--pb-color-bad);
}

.pb-cm-count {
  color: var(--pb-color-text-muted);
  font: var(--pb-font-small);
}

.pb-cm-note {
  margin: 0;
  padding: var(--pb-space-gap);
  color: var(--pb-color-text-muted);
  font: var(--pb-font-small);
}
`;
}

function barRules(): string {
  return `.pb-cb {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--pb-space-gap);
  padding: var(--pb-space-gap) var(--pb-space-pad);
  border-top: thin solid var(--pb-color-border);
  font: var(--pb-font-small);
}

.pb-cb button,
.pb-cd-actions button {
  padding: var(--pb-space-gap) var(--pb-space-pad);
  border: thin solid var(--pb-color-border);
  border-radius: var(--pb-radius-control);
  background: transparent;
  color: var(--pb-color-text);
  font: inherit;
  cursor: pointer;
}
`;
}

function dialogRules(): string {
  return `.pb-cd {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--pb-space-pad);
  background: color-mix(in srgb, var(--pb-color-surface) 80%, transparent);
  border-radius: var(--pb-radius-box);
}

.pb-cd-box {
  display: flex;
  flex-direction: column;
  gap: var(--pb-space-gap);
  padding: var(--pb-space-pad);
  background: var(--pb-color-surface);
  border: thin solid var(--pb-color-border);
  border-radius: var(--pb-radius-box);
  box-shadow: var(--pb-shadow-box);
}

.pb-cd-line {
  margin: 0;
}

.pb-cd-note {
  color: var(--pb-color-bad);
}

.pb-cd-check {
  display: flex;
  align-items: flex-start;
  gap: var(--pb-space-gap);
}

.pb-cd-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--pb-space-gap);
}

.pb-cd-actions .pb-cd-confirm {
  background: var(--pb-color-bad);
  border-color: var(--pb-color-bad);
  color: var(--pb-color-on-status);
}`;
}

export const menuRules = (): string => [popupRules(), barRules(), dialogRules()].join('\n\n');
