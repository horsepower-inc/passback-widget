// The review panel's stylesheet: the bubble's look, tokens only, plus layout and spacing on top of
// the widget's own field, note, bar and button classes (styles.ts); it ships inside the review chunk.
// The panel is not a .pb-bubble itself: the overlay hides every bubble while its own panel is closed.
export const REVIEW_RULES = `.pb-review {
  --pb-space-pad: 16px;
  display: flex;
  flex-direction: column;
  padding: var(--pb-space-pad);
  border-radius: var(--pb-radius-box);
  background: var(--pb-color-surface);
  color: var(--pb-color-text);
  font: var(--pb-font-body);
  box-shadow: var(--pb-shadow-box);
  position: fixed;
  top: var(--pb-space-gap);
  right: var(--pb-space-gap);
  z-index: var(--pb-z);
  box-sizing: border-box;
  gap: 14px;
  width: min(var(--pb-size-box), calc(100vw - 2 * var(--pb-space-gap)));
  max-height: calc(100vh - 2 * var(--pb-space-gap));
  overflow: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  pointer-events: auto;
}

.pb-review h2,
.pb-review p,
.pb-review ul,
.pb-review dl,
.pb-review dd {
  margin: 0;
}

.pb-review-head {
  display: flex;
  align-items: flex-start;
  gap: var(--pb-space-gap);
}

.pb-review-title {
  font: inherit;
  font-weight: 600;
}

.pb-review-meta {
  margin-top: 2px;
}

.pb-review-pager {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
  flex: none;
}

.pb-review-where {
  min-width: 34px;
  text-align: center;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.pb-review-rule {
  height: 0;
  border-top: thin solid var(--pb-color-border);
  margin: 0 calc(var(--pb-space-pad) * -1);
}

.pb-review-text {
  font-size: 14px;
  line-height: 1.45;
}

.pb-review-strong {
  font-weight: 600;
}

.pb-review-kind {
  margin-bottom: -6px;
}

.pb-review-question {
  padding-left: 10px;
  border-left: 2px solid var(--pb-color-ask);
}

.pb-review-labels {
  display: flex;
  gap: 6px;
}

.pb-review-labels .pb-ico {
  flex: 1;
  padding: 0 6px;
  white-space: nowrap;
}

.pb-review .pb-ico[aria-pressed='true'] {
  background: var(--pb-color-main);
  border-color: var(--pb-color-main);
  color: var(--pb-color-on-main);
}

.pb-review-unsorted {
  color: var(--pb-color-ask);
}

.pb-review-thread {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.pb-review-thread .pb-note {
  color: var(--pb-color-text);
}

.pb-review-added {
  color: var(--pb-color-text-muted);
  font-weight: 500;
}

.pb-review-field {
  box-sizing: border-box;
  width: 100%;
  min-height: 64px;
  padding: 8px 10px;
  border-width: thin;
  resize: none;
}

.pb-review-lead {
  color: var(--pb-color-text);
}

.pb-review-sum {
  display: grid;
  grid-template-columns: 1fr auto;
  row-gap: 8px;
}

.pb-review-sum dd {
  font-variant-numeric: tabular-nums;
}

.pb-review-notice,
.pb-review-warn {
  color: var(--pb-color-bad);
}

.pb-review-notice:empty {
  display: none;
}

.pb-review-held {
  padding-left: var(--pb-space-pad);
}

.pb-review-row {
  font-weight: 600;
}

.pb-review-link {
  all: unset;
  cursor: pointer;
  text-decoration: underline;
}

.pb-review .pb-send:disabled,
.pb-review .pb-ico:disabled,
.pb-review-field:disabled {
  opacity: var(--pb-opacity-idle);
  cursor: default;
}

.pb-review button:focus-visible,
.pb-review a:focus-visible,
.pb-review textarea:focus-visible {
  outline: thin solid var(--pb-color-text);
  outline-offset: thin;
}`;
