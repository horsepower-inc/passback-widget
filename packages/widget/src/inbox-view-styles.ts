// The menu is one row of constant height that never wraps (board G7-Menu).
export const MENU_HEIGHT = '34px';

function menuRules(): string {
  return `.pb-iv {
  display: flex;
  flex-direction: column;
  margin: calc(-1 * var(--pb-space-pad));
}

.pb-iv-menu {
  display: flex;
  height: ${MENU_HEIGHT};
  overflow-x: auto;
  border-bottom: thin solid var(--pb-color-border);
}

.pb-iv-tab {
  flex: none;
  height: 100%;
  padding: 0 var(--pb-space-pad);
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--pb-color-text-muted);
  font: inherit;
  white-space: nowrap;
  cursor: pointer;
}

.pb-iv-tab[aria-selected="true"] {
  color: var(--pb-color-text);
  border-bottom-color: var(--pb-color-text);
}

.pb-iv-count {
  margin-left: 4px;
  color: var(--pb-color-text-muted);
  font-size: var(--pb-font-small);
}`;
}

function listRules(): string {
  return `.pb-iv-count[data-needs] { color: var(--pb-color-ask); }

.pb-iv-list {
  max-height: 50vh;
  overflow-y: auto;
}

.pb-iv-group {
  padding: var(--pb-space-gap) var(--pb-space-pad) 2px;
  color: var(--pb-color-text-muted);
  font-size: var(--pb-font-small);
}

.pb-iv-row {
  display: grid;
  grid-template-columns: 22px 1fr auto;
  align-items: center;
  gap: 0 var(--pb-space-gap);
  padding: 4px var(--pb-space-pad);
}

.pb-iv-row[data-open] { cursor: pointer; }

.pb-iv-row[aria-selected="true"],
.pb-iv-row:hover { background: var(--pb-color-field); }

.pb-iv-row[data-muted] { color: var(--pb-color-text-muted); }`;
}

function cellRules(): string {
  return `.pb-iv-n {
  grid-row: 1 / span 2;
  font-weight: 600;
}

.pb-iv-comment,
.pb-iv-line {
  grid-column: 2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pb-iv-line {
  color: var(--pb-color-text-muted);
  font-size: var(--pb-font-small);
}

.pb-iv-act,
.pb-iv-all {
  grid-row: 1 / span 2;
  visibility: hidden;
  border: thin solid var(--pb-color-border);
  border-radius: var(--pb-radius-control);
  background: transparent;
  color: var(--pb-color-text);
  font: inherit;
  cursor: pointer;
}

.pb-iv-row:hover .pb-iv-act,
.pb-iv-row:focus-within .pb-iv-act,
.pb-iv-row[aria-selected="true"] .pb-iv-act { visibility: visible; }

.pb-iv-acts {
  grid-row: 1 / span 2;
  display: flex;
  gap: var(--pb-space-gap);
}

.pb-fx-box {
  grid-column: 1 / -1;
  padding: var(--pb-space-gap) 0;
  cursor: auto;
}

.pb-fx-error { color: var(--pb-color-ask); }

.pb-iv-empty,
.pb-iv-note {
  padding: var(--pb-space-gap) var(--pb-space-pad);
  color: var(--pb-color-text-muted);
}

.pb-iv-foot {
  display: flex;
  align-items: center;
  gap: var(--pb-space-gap);
  padding: var(--pb-space-pad);
  border-top: thin solid var(--pb-color-border);
  color: var(--pb-color-text-muted);
}

.pb-iv-send {
  margin-left: auto;
  padding: 4px var(--pb-space-pad);
  border: 0;
  border-radius: var(--pb-radius-control);
  background: var(--pb-color-main);
  color: var(--pb-color-on-main);
  font: inherit;
  cursor: pointer;
}

.pb-iv-all { visibility: visible; padding: 4px var(--pb-space-pad); }

.pb-iv-act:disabled,
.pb-iv-all:disabled,
.pb-iv-dest-btn:disabled,
.pb-iv-file:disabled,
.pb-iv-send:disabled { opacity: 0.4; }`;
}

// The open task replaces the menu and the list (board G7-Question).
function taskRules(): string {
  return `.pb-it-head {
  display: grid;
  gap: 2px;
  padding: var(--pb-space-pad);
  border-bottom: thin solid var(--pb-color-border);
}

.pb-it-back {
  justify-self: start;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--pb-color-text-muted);
  font: inherit;
  cursor: pointer;
}

.pb-it-title { font-weight: 600; }

.pb-it-n { margin-right: var(--pb-space-gap); }

.pb-it-facts,
.pb-it-meta,
.pb-it-note {
  color: var(--pb-color-text-muted);
  font-size: var(--pb-font-small);
}

`;
}

function answerRules(): string {
  return `.pb-it-lines {
  max-height: 40vh;
  overflow-y: auto;
}

.pb-it-line { padding: 4px var(--pb-space-pad); }

.pb-it-who {
  margin-right: var(--pb-space-gap);
  color: var(--pb-it-who-color);
}

.pb-it-line[data-kind="question"] {
  --pb-it-who-color: var(--pb-color-ask);
  background: var(--pb-color-field);
  border-left: 2px solid var(--pb-color-ask);
}

.pb-it-text { white-space: pre-wrap; }

.pb-it-answer {
  display: grid;
  gap: var(--pb-space-gap);
  padding: var(--pb-space-pad);
  border-top: thin solid var(--pb-color-border);
}

.pb-it-box,
.pb-fx-box textarea {
  box-sizing: border-box;
  width: 100%;
  min-height: 56px;
  padding: 4px var(--pb-space-gap);
  border: thin solid var(--pb-color-border);
  border-radius: var(--pb-radius-control);
  background: var(--pb-color-field);
  color: var(--pb-color-text);
  font: inherit;
  resize: vertical;
}

.pb-it-box:disabled { opacity: 0.6; }

.pb-it-actions,
.pb-it-withdraw {
  display: flex;
  align-items: center;
  gap: var(--pb-space-gap);
}

.pb-it-send {
  margin-left: auto;
  padding: 4px var(--pb-space-pad);
  border: 0;
  border-radius: var(--pb-radius-control);
  background: var(--pb-color-main);
  color: var(--pb-color-on-main);
  font: inherit;
  cursor: pointer;
}

.pb-it-withdraw-btn { visibility: visible; padding: 4px var(--pb-space-pad); }

.pb-it-send:disabled,
.pb-it-withdraw-btn:disabled { opacity: 0.4; }`;
}

// The destination switch of a To send row and the file button (board G4-Open).
function destRules(): string {
  return `.pb-iv-dest {
  display: inline-flex;
  grid-column: 2;
  justify-self: start;
  border: thin solid var(--pb-color-border);
  border-radius: var(--pb-radius-control);
  overflow: hidden;
}

.pb-iv-dest-btn {
  padding: 0 var(--pb-space-gap);
  border: 0;
  background: transparent;
  color: var(--pb-color-text);
  font: inherit;
  font-size: var(--pb-font-small);
  cursor: pointer;
}

.pb-iv-dest-btn[aria-pressed="true"] {
  background: var(--pb-color-main);
  color: var(--pb-color-on-main);
}

.pb-iv-file {
  padding: 4px var(--pb-space-pad);
  border: thin solid var(--pb-color-border);
  border-radius: var(--pb-radius-control);
  background: transparent;
  color: var(--pb-color-text);
  font: inherit;
  cursor: pointer;
}`;
}

export function inboxViewRules(): string {
  return [menuRules(), listRules(), cellRules(), destRules(), taskRules(), answerRules()].join(
    '\n\n',
  );
}
