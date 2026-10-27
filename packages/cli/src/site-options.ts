import { DEFAULT_API } from './account';

export type SiteOptions = { siteKey: string; endpoint: string };
export type OptionsEdit =
  { ok: true; changed: boolean; text: string } | { ok: false; reason: string };
export type SourceFile = { path: string; text: string };

export const VITE_MODE_LINE = "mode: process.env.NODE_ENV === 'production' ? 'relay' : 'agent'";
export const NEXT_MODE_PROP = "mode={process.env.NODE_ENV === 'production' ? 'relay' : 'agent'}";

export const VITE_STAGING_ENTRY = "stagingModes: ['staging']";

const UNSAFE: OptionsEdit = { ok: false, reason: 'unsafe site key or endpoint' };

function isSafe(site: SiteOptions): boolean {
  return (
    /^[A-Za-z0-9_-]{1,128}$/.test(site.siteKey) && /^https?:\/\/[^\s'"\\<>{}]+$/.test(site.endpoint)
  );
}

function viteEntries(site: SiteOptions): string {
  const key = `siteKey: '${site.siteKey}'`;
  return site.endpoint === DEFAULT_API ? key : `${key}, endpoint: '${site.endpoint}'`;
}

function layoutAttrs(site: SiteOptions): string {
  const key = `siteKey="${site.siteKey}"`;
  return site.endpoint === DEFAULT_API ? key : `${key} endpoint="${site.endpoint}"`;
}

function edited(before: string, after: string): OptionsEdit {
  return { ok: true, changed: after !== before, text: after };
}

/** Writes siteKey, endpoint (omitted when it is the default API) and (when absent) the mode line and stagingModes into the one passback() call of a vite.config. */
export function setViteSiteOptions(text: string, site: SiteOptions): OptionsEdit {
  if (!isSafe(site)) {
    return UNSAFE;
  }
  const calls = [...text.matchAll(/\bpassback\(\s*(\{[^{}]*\})?\s*\)/g)];
  if (calls.length !== 1) {
    return { ok: false, reason: 'no single passback() call' };
  }
  const object = calls[0]![1] ?? '{}';
  let rest = object
    .slice(1, -1)
    .replace(/\s*(siteKey|endpoint)\s*:\s*(['"])[^'"]*\2\s*,?/g, '')
    .trim()
    .replace(/,$/, '');
  if (!/\bmode\s*:/.test(rest)) {
    rest = rest === '' ? VITE_MODE_LINE : `${rest}, ${VITE_MODE_LINE}`;
  }
  if (!/\bstagingModes\s*:/.test(rest)) {
    rest = rest.replace(
      /\bmode\s*:\s*(?:'[^']*'|"[^"]*"|[^,]+?)(?=\s*(?:,|$))/,
      (m) => `${m}, ${VITE_STAGING_ENTRY}`,
    );
  }
  const call = `passback({ ${rest}, ${viteEntries(site)} })`;
  return edited(
    text,
    text.replace(calls[0]![0], () => call),
  );
}

/** Writes siteKey, endpoint (omitted when it is the default API) and (when absent) the mode prop into the one <Passback /> tag of a layout. */
export function setLayoutSiteOptions(text: string, site: SiteOptions): OptionsEdit {
  if (!isSafe(site)) {
    return UNSAFE;
  }
  const tags = [...text.matchAll(/<Passback\b([^>]*?)\s*\/>/g)];
  if (tags.length !== 1) {
    return { ok: false, reason: 'no single <Passback /> tag' };
  }
  let attrs = (tags[0]![1] ?? '').replace(/\s*(siteKey|endpoint)=("[^"]*"|'[^']*')/g, '').trim();
  if (!/\bmode\s*=/.test(attrs)) {
    attrs = attrs === '' ? NEXT_MODE_PROP : `${attrs} ${NEXT_MODE_PROP}`;
  }
  const tag = `<Passback ${attrs} ${layoutAttrs(site)} />`;
  return edited(
    text,
    text.replace(tags[0]![0], () => tag),
  );
}

function isViteConfig(filePath: string): boolean {
  return (filePath.split('/').pop() ?? '').startsWith('vite.config');
}

function manualLine(filePath: string, site: SiteOptions, reason: string): string {
  return isViteConfig(filePath)
    ? `${filePath}: add ${VITE_MODE_LINE}, ${VITE_STAGING_ENTRY}, ${viteEntries(site)} to passback() by hand (${reason})`
    : `${filePath}: add ${NEXT_MODE_PROP} ${layoutAttrs(site)} to <Passback /> by hand (${reason})`;
}

function buildLine(filePath: string): string {
  const slash = filePath.lastIndexOf('/');
  const dir = slash === -1 ? '.' : filePath.slice(0, slash);
  return `${dir}: run \`vite build --mode staging\` to build with the widget; staging must be listed in stagingModes (an existing list is preserved, so add staging to it or build with a mode already listed)`;
}

/** The writes with each source's plugin options set, and a manual line for each source that refused. */
export function planSiteOptions(
  sources: SourceFile[],
  writes: SourceFile[],
  site: SiteOptions,
): { writes: SourceFile[]; printed: string[] } {
  const out = writes.map((w) => ({ ...w }));
  const printed: string[] = [];
  for (const source of sources) {
    const index = out.findIndex((w) => w.path === source.path);
    const current = index === -1 ? source.text : out[index]!.text;
    const vite = isViteConfig(source.path);
    const edit = (vite ? setViteSiteOptions : setLayoutSiteOptions)(current, site);
    if (!edit.ok) {
      printed.push(manualLine(source.path, site, edit.reason));
    } else if (edit.changed && index === -1) {
      out.push({ path: source.path, text: edit.text });
    } else if (edit.changed) {
      out[index] = { path: source.path, text: edit.text };
    }
    if (vite) {
      printed.push(buildLine(source.path));
    }
  }
  return { writes: out, printed };
}
