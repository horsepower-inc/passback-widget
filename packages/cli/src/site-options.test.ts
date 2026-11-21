import { describe, expect, it } from 'vitest';
import { planSiteOptions, setLayoutSiteOptions, setViteSiteOptions } from './site-options';

const SITE = { siteKey: 'pb_1', endpoint: 'https://api.example' };
const MODE = "mode: process.env.NODE_ENV === 'production' ? 'relay' : 'agent'";
const STAGING = "stagingModes: ['staging']";
const BUILD = 'vite build --mode staging';
const PROP = "mode={process.env.NODE_ENV === 'production' ? 'relay' : 'agent'}";

function textOf(edit: ReturnType<typeof setViteSiteOptions>): string {
  if (!edit.ok) {
    throw new Error(edit.reason);
  }
  return edit.text;
}

describe('setViteSiteOptions', () => {
  it('adds the mode line, siteKey and endpoint to an empty passback() call', () => {
    const edit = setViteSiteOptions('plugins: [passback(), react()],', SITE);

    expect(edit).toEqual({
      ok: true,
      changed: true,
      text: `plugins: [passback({ ${MODE}, ${STAGING}, siteKey: 'pb_1', endpoint: 'https://api.example' }), react()],`,
    });
  });

  it('keeps the root option and adds the site options after it', () => {
    const text = textOf(setViteSiteOptions("plugins: [passback({ root: '../..' })],", SITE));

    expect(text).toBe(
      `plugins: [passback({ root: '../..', ${MODE}, ${STAGING}, siteKey: 'pb_1', endpoint: 'https://api.example' })],`,
    );
  });

  it('keeps a mode the customer wrote and adds no second one', () => {
    const vite = textOf(setViteSiteOptions("plugins: [passback({ mode: 'off' })],", SITE));
    const layout = textOf(setLayoutSiteOptions('<head><Passback mode="relay" /></head>', SITE));

    expect(vite).toBe(
      "plugins: [passback({ mode: 'off', stagingModes: ['staging'], siteKey: 'pb_1', endpoint: 'https://api.example' })],",
    );
    expect(vite).not.toContain('NODE_ENV');
    expect(layout).toBe(
      '<head><Passback mode="relay" siteKey="pb_1" endpoint="https://api.example" /></head>',
    );
    expect(layout).not.toContain('NODE_ENV');
  });

  it('replaces an older site key and changes nothing on a second run', () => {
    const first = textOf(
      setViteSiteOptions('plugins: [passback()],', { ...SITE, siteKey: 'pb_old' }),
    );
    const second = textOf(setViteSiteOptions(first, SITE));
    const third = setViteSiteOptions(second, SITE);

    expect(second).toBe(
      `plugins: [passback({ ${MODE}, ${STAGING}, siteKey: 'pb_1', endpoint: 'https://api.example' })],`,
    );
    expect(second).not.toContain('pb_old');
    expect(third).toEqual({ ok: true, changed: false, text: second });

    const tag = textOf(setLayoutSiteOptions('<Passback />', SITE));
    expect(setLayoutSiteOptions(tag, SITE)).toEqual({ ok: true, changed: false, text: tag });
  });

  it('refuses a config with no passback() call or with two', () => {
    const reason = 'no single passback() call';

    expect(setViteSiteOptions('plugins: [react()],', SITE)).toEqual({ ok: false, reason });
    expect(setViteSiteOptions('plugins: [passback(), passback()],', SITE)).toEqual({
      ok: false,
      reason,
    });
  });
});

describe('stagingModes', () => {
  it('adds stagingModes beside mode and preserves existing stagingModes values', () => {
    const empty = textOf(setViteSiteOptions('passback()', SITE));
    const custom = textOf(
      setViteSiteOptions(
        "passback({ mode: 'relay', stagingModes: ['qa', 'staging'], root: '..' })",
        SITE,
      ),
    );
    const none = textOf(setViteSiteOptions('passback({ stagingModes: [] })', SITE));
    const withMode = textOf(setViteSiteOptions("passback({ mode: 'relay', root: '..' })", SITE));

    expect(empty).toContain(`${MODE}, ${STAGING}, siteKey`);
    expect(withMode).toBe(
      "passback({ mode: 'relay', stagingModes: ['staging'], root: '..', siteKey: 'pb_1', endpoint: 'https://api.example' })",
    );
    expect(custom).toBe(
      "passback({ mode: 'relay', stagingModes: ['qa', 'staging'], root: '..', siteKey: 'pb_1', endpoint: 'https://api.example' })",
    );
    expect(none).toBe(
      `passback({ stagingModes: [], ${MODE}, siteKey: 'pb_1', endpoint: 'https://api.example' })`,
    );
    expect(none).not.toContain("'staging'");
    expect(setViteSiteOptions(empty, SITE)).toEqual({ ok: true, changed: false, text: empty });
    expect(setViteSiteOptions(none, SITE)).toEqual({ ok: true, changed: false, text: none });
  });
});

describe('setLayoutSiteOptions', () => {
  it('adds the mode prop, siteKey and endpoint to the Passback tag in the layout', () => {
    const edit = setLayoutSiteOptions('<head>\n  <Passback />\n</head>', SITE);

    expect(edit).toEqual({
      ok: true,
      changed: true,
      text: `<head>\n  <Passback ${PROP} siteKey="pb_1" endpoint="https://api.example" />\n</head>`,
    });
  });

  it('refuses a site key or endpoint with a quote in it', () => {
    const reason = 'unsafe site key or endpoint';

    expect(setViteSiteOptions('passback()', { ...SITE, siteKey: "pb_1'" })).toEqual({
      ok: false,
      reason,
    });
    expect(
      setLayoutSiteOptions('<Passback />', { ...SITE, endpoint: 'https://api.example"' }),
    ).toEqual({
      ok: false,
      reason,
    });
  });
});

const PROD = 'https://api.passback.dev';
const DEFAULT_SITE = { siteKey: 'pb_1', endpoint: PROD };

describe('default endpoint', () => {
  it('omits the default endpoint from Vite edits', () => {
    const empty = setViteSiteOptions('passback()', DEFAULT_SITE);
    const replaced = textOf(
      setViteSiteOptions(
        "passback({ root: '..', mode: 'off', siteKey: 'old', endpoint: 'https://api.example' })",
        DEFAULT_SITE,
      ),
    );

    expect(empty).toEqual({
      ok: true,
      changed: true,
      text: `passback({ ${MODE}, ${STAGING}, siteKey: 'pb_1' })`,
    });
    expect(replaced).toBe(
      "passback({ root: '..', mode: 'off', stagingModes: ['staging'], siteKey: 'pb_1' })",
    );
    expect(setViteSiteOptions(replaced, DEFAULT_SITE)).toMatchObject({ changed: false });
  });

  it('omits the default endpoint from Next edits', () => {
    const empty = setLayoutSiteOptions('<Passback />', DEFAULT_SITE);
    const replaced = textOf(
      setLayoutSiteOptions(
        '<Passback theme="dark" mode="relay" siteKey="old" endpoint="https://api.example" />',
        DEFAULT_SITE,
      ),
    );

    expect(empty).toEqual({
      ok: true,
      changed: true,
      text: `<Passback ${PROP} siteKey="pb_1" />`,
    });
    expect(replaced).toBe('<Passback theme="dark" mode="relay" siteKey="pb_1" />');
    expect(setLayoutSiteOptions(replaced, DEFAULT_SITE)).toMatchObject({ changed: false });
  });

  it('omits the default endpoint from manual instructions', () => {
    const plan = planSiteOptions(
      [
        { path: 'vite.config.js', text: 'plugins: [],' },
        { path: 'app/layout.tsx', text: '<html></html>' },
      ],
      [{ path: '.mcp.json', text: '{}' }],
      DEFAULT_SITE,
    );
    const planned = planSiteOptions(
      [{ path: 'vite.config.ts', text: 'plugins: [],' }],
      [
        {
          path: 'vite.config.ts',
          text: "plugins: [passback({ siteKey: 'x', endpoint: 'https://api.example' })],",
        },
      ],
      DEFAULT_SITE,
    );

    expect(plan.writes).toEqual([{ path: '.mcp.json', text: '{}' }]);
    expect(plan.printed.filter((l) => !l.includes(BUILD))).toEqual([
      `vite.config.js: add ${MODE}, ${STAGING}, siteKey: 'pb_1' to passback() by hand (no single passback() call)`,
      `app/layout.tsx: add ${PROP} siteKey="pb_1" to <Passback /> by hand (no single <Passback /> tag)`,
    ]);
    expect(planned.writes).toEqual([
      {
        path: 'vite.config.ts',
        text: `plugins: [passback({ mode: process.env.NODE_ENV === 'production' ? 'relay' : 'agent', stagingModes: ['staging'], siteKey: 'pb_1' })],`,
      },
    ]);
  });

  it('preserves nondefault endpoints verbatim', () => {
    const slash = { siteKey: 'pb_1', endpoint: `${PROD}/` };

    expect(textOf(setViteSiteOptions('passback()', SITE))).toContain(
      "siteKey: 'pb_1', endpoint: 'https://api.example' }",
    );
    expect(textOf(setViteSiteOptions('passback()', slash))).toContain(`endpoint: '${PROD}/'`);
    expect(textOf(setLayoutSiteOptions('<Passback />', SITE))).toContain(
      'endpoint="https://api.example"',
    );
    expect(textOf(setLayoutSiteOptions('<Passback />', slash))).toContain(`endpoint="${PROD}/"`);
    const plan = planSiteOptions([{ path: 'app/layout.tsx', text: '<html></html>' }], [], slash);
    expect(plan.printed[0]).toContain(`siteKey="pb_1" endpoint="${PROD}/" to <Passback />`);
  });
});

describe('planSiteOptions', () => {
  it('edits the planned text of a file init is already writing', () => {
    const plan = planSiteOptions(
      [{ path: 'vite.config.ts', text: 'plugins: [],' }],
      [
        { path: '.mcp.json', text: '{}' },
        { path: 'vite.config.ts', text: 'plugins: [passback()],' },
      ],
      SITE,
    );

    expect(plan.writes).toEqual([
      { path: '.mcp.json', text: '{}' },
      {
        path: 'vite.config.ts',
        text: `plugins: [passback({ ${MODE}, ${STAGING}, siteKey: 'pb_1', endpoint: 'https://api.example' })],`,
      },
    ]);
    expect(plan.printed).toHaveLength(1);
    expect(plan.printed[0]).toContain(BUILD);
  });

  it('prints the manual line for a file it cannot edit', () => {
    const plan = planSiteOptions(
      [
        { path: 'apps/site/vite.config.js', text: 'plugins: [],' },
        { path: 'apps/web/app/layout.tsx', text: '<html></html>' },
      ],
      [],
      SITE,
    );

    expect(plan.writes).toEqual([]);
    expect(plan.printed).toHaveLength(3);
    expect(plan.printed.filter((l) => !l.includes(BUILD))).toEqual([
      `apps/site/vite.config.js: add ${MODE}, ${STAGING}, siteKey: 'pb_1', endpoint: 'https://api.example' to passback() by hand (no single passback() call)`,
      `apps/web/app/layout.tsx: add ${PROP} siteKey="pb_1" endpoint="https://api.example" to <Passback /> by hand (no single <Passback /> tag)`,
    ]);
  });

  it('prints staging build guidance for each Vite config including refused and unchanged configs', () => {
    const done = textOf(setViteSiteOptions('passback()', SITE));
    const plan = planSiteOptions(
      [
        { path: 'vite.config.ts', text: done },
        { path: 'apps/site/vite.config.js', text: 'plugins: [],' },
        { path: 'apps/web/vite.config.ts', text: 'plugins: [passback()],' },
        { path: 'apps/next/app/layout.tsx', text: '<Passback />' },
      ],
      [],
      SITE,
    );
    const guidance = plan.printed.filter((l) => l.includes(BUILD));

    expect(guidance).toHaveLength(3);
    expect(guidance[0]).toMatch(/^\.: /);
    expect(guidance[1]).toMatch(/^apps\/site: /);
    expect(guidance[2]).toMatch(/^apps\/web: /);
    expect(guidance[0]).toContain('stagingModes');
    expect(guidance[0]).toContain('preserved');
    expect(plan.printed.filter((l) => l.includes('by hand'))).toHaveLength(1);
    expect(plan.writes.map((w) => w.path)).toEqual([
      'apps/web/vite.config.ts',
      'apps/next/app/layout.tsx',
    ]);
  });

  it('prints no Vite guidance for Next-only setup', () => {
    const plan = planSiteOptions([{ path: 'app/layout.tsx', text: '<Passback />' }], [], SITE);

    expect(plan.printed).toEqual([]);
  });
});
