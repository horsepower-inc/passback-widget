import type { Payload } from './payload';

// input values, authorization/cookie headers and JWT-shaped strings never leave the browser.

export const REDACTED = '[redacted]';

const SECRET_KEY = /^(?:(?:proxy-)?authorization|cookie|set-cookie)$/i;
const JWT = /\beyJ[\w-]*\.[\w-]+\.[\w-]*/g;
// `Authorization: Bearer x`, `"cookie":"a=b"`, `{\"cookie\":\"a=b\"}` — header values embedded in
// bodies, messages and stacks, including JSON that was escaped into a string.
const SECRET_HEADER =
  /\b((?:proxy-)?authorization|set-cookie|cookie)(\\?["']?\s*[:=]\s*)(?:\\?"(?:[^"\\]|\\(?!"))*\\?"|'[^']*'|[^\r\n"'\\]*)/gi;
const FORM_FIELD = new Set(['input', 'textarea', 'select']);
// Attribute values are skipped as quoted chunks so a `>` inside one does not end the tag early.
const VALUE_ATTR =
  /(<(?:input|select|option)\b(?:[^>"']|"[^"]*"|'[^']*')*?\svalue\s*=\s*)(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
// `$` covers outerHTML trimmed for the 50 KB limit before the closing tag.
const TEXTAREA_BODY = /(<textarea\b[^>]*>)[\s\S]*?(<\/textarea>|$)/gi;

function redactString(s: string): string {
  return s.replace(JWT, REDACTED).replace(SECRET_HEADER, `$1$2${REDACTED}`);
}

function redactDeep(value: unknown): unknown {
  if (typeof value === 'string') return redactString(value);
  if (Array.isArray(value)) return value.map(redactDeep);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, SECRET_KEY.test(k) ? REDACTED : redactDeep(v)]),
    );
  }
  return value;
}

/** Returns a copy of the payload with secrets replaced by `[redacted]`; the input is not mutated. */
export function redact(payload: Payload): Payload {
  const out = redactDeep(payload) as Payload;
  const el = out.element;
  el.outerHTML = el.outerHTML
    .replace(VALUE_ATTR, `$1"${REDACTED}"`)
    .replace(TEXTAREA_BODY, `$1${REDACTED}$2`);
  if (FORM_FIELD.has(el.tag.toLowerCase())) {
    if ('value' in el.attrs) el.attrs.value = REDACTED;
    if (el.text) el.text = REDACTED;
  }
  return out;
}
