import { describe, expect, it } from 'vitest';
import { NEXT_ROUTE_TEXT, addPassbackTag, nextRoutePath, planNextApp } from './next-files';
import type { NextAppInput } from './next-files';

const app: NextAppInput = {
  dir: 'apps/web',
  rootRelative: '../..',
  srcApp: false,
  routeExists: false,
  config: { path: 'apps/web/next.config.mjs', text: 'export default config;\n' },
};

describe('planNextApp', () => {
  it('plans the route file under app/api/passback when the app has no route file', () => {
    const plan = planNextApp(app);
    expect(plan.writes[0]).toEqual({
      path: 'apps/web/app/api/passback/[[...path]]/route.ts',
      text: NEXT_ROUTE_TEXT,
    });
  });

  it('plans the route file under src/app when the app keeps its code in src', () => {
    const plan = planNextApp({ ...app, srcApp: true });
    expect(plan.writes[0]?.path).toBe('apps/web/src/app/api/passback/[[...path]]/route.ts');
  });

  it('plans no route write when the route file already exists', () => {
    const plan = planNextApp({ ...app, routeExists: true });
    expect(plan.writes.map((write) => write.path)).toEqual(['apps/web/next.config.mjs']);
  });

  it('plans the wrapped config in place for a recognised shape', () => {
    const plan = planNextApp({ ...app, routeExists: true });
    expect(plan.writes).toHaveLength(1);
    expect(plan.writes[0]?.text).toContain("withPassback(config, { root: '../..' })");
  });

  it('creates next.config.mjs when the app has no config file', () => {
    const plan = planNextApp({ ...app, routeExists: true, config: undefined });
    expect(plan.writes).toEqual([
      {
        path: 'apps/web/next.config.mjs',
        text:
          "import { withPassback } from '@passback/next';\n" +
          "export default withPassback({}, { root: '../..' });\n",
      },
    ]);
  });

  it('prints the manual wrap line and writes no config when the shape is unrecognised', () => {
    const plan = planNextApp({
      ...app,
      routeExists: true,
      config: { path: 'apps/web/next.config.mjs', text: 'const x = 1;\n' },
    });
    expect(plan.writes).toEqual([]);
    expect(plan.printed[0]).toBe(
      "apps/web: next.config left as it is (unrecognised next.config shape); wrap its export by hand: withPassback(config, { root: '../..' })",
    );
  });

  it('plans no config write when the config is already wrapped', () => {
    const plan = planNextApp({
      ...app,
      routeExists: true,
      config: { path: 'apps/web/next.config.mjs', text: 'export default withPassback(c, {});\n' },
    });
    expect(plan.writes).toEqual([]);
  });

  it('always prints the layout line and the install line for the app', () => {
    const plan = planNextApp({ ...app, routeExists: true });
    expect(plan.printed.slice(-2)).toEqual([
      "apps/web: add <Passback /> inside <head> of the layout that renders <html>: import { Passback } from '@passback/next'",
      'apps/web: install it: npm i -D @passback/next',
    ]);
  });

  it('uses paths relative to the project root for a subdirectory app and for an app at the root', () => {
    expect(nextRoutePath('apps/web', false)).toBe('apps/web/app/api/passback/[[...path]]/route.ts');
    expect(nextRoutePath('.', false)).toBe('app/api/passback/[[...path]]/route.ts');
    expect(nextRoutePath('.', true)).toBe('src/app/api/passback/[[...path]]/route.ts');
    const plan = planNextApp({ ...app, dir: '.', rootRelative: '.', config: undefined });
    expect(plan.writes.map((write) => write.path)).toEqual([
      'app/api/passback/[[...path]]/route.ts',
      'next.config.mjs',
    ]);
  });
});

const LAYOUT = `import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "App" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
`;

const IMPORT = "import { Passback } from '@passback/next';";

function edited(text: string): string {
  const edit = addPassbackTag(text);
  if (!edit.ok) {
    throw new Error(edit.reason);
  }
  return edit.text;
}

describe('addPassbackTag', () => {
  it('adds a head with <Passback /> before the body when the layout has none', () => {
    const text = edited(LAYOUT);
    expect(text).toContain(
      '      <head>\n        <Passback />\n      </head>\n      <body>{children}</body>\n',
    );
    expect(text).toContain(`import "./globals.css";\n${IMPORT}\n`);
  });

  it('adds <Passback /> into an existing head', () => {
    const withHead = LAYOUT.replace(
      '      <body>',
      '      <head>\n        <title>x</title>\n      </head>\n      <body>',
    );
    const text = edited(withHead);
    expect(text).toContain('        <title>x</title>\n        <Passback />\n      </head>\n');
    expect(text).toContain(IMPORT);
  });

  it('adds <head><Passback /></head> inline when the body tag shares its line', () => {
    const inline = LAYOUT.replace(
      /<html lang="en">\n\s*<body>\{children\}<\/body>\n\s*<\/html>/,
      '<html lang="en"><body>{children}</body></html>',
    );
    expect(edited(inline)).toContain(
      '<html lang="en"><head><Passback /></head><body>{children}</body></html>',
    );
  });

  it('leaves a layout that already renders <Passback /> unchanged', () => {
    const text = LAYOUT.replace('<body>', '<head><Passback /></head><body>');
    expect(addPassbackTag(text)).toEqual({ ok: true, changed: false, text });
  });

  it('refuses a layout with two body tags, without an import, or with a self-closing head', () => {
    const refused = { ok: false, reason: 'unrecognised layout shape' };
    expect(addPassbackTag(LAYOUT.replace('</html>', '<body></body></html>'))).toEqual(refused);
    expect(addPassbackTag(LAYOUT.replace(/^import .*\n/gm, ''))).toEqual(refused);
    expect(addPassbackTag(LAYOUT.replace('<body>', '<head /><body>'))).toEqual(refused);
  });

  it('plans the edited layout and prints no layout line', () => {
    const plan = planNextApp({
      ...app,
      routeExists: true,
      layout: { path: 'apps/web/app/layout.tsx', text: LAYOUT },
    });
    expect(plan.writes.map((write) => write.path)).toEqual([
      'apps/web/next.config.mjs',
      'apps/web/app/layout.tsx',
    ]);
    expect(plan.writes[1]?.text).toContain('<Passback />');
    expect(plan.printed).toEqual(['apps/web: install it: npm i -D @passback/next']);
  });

  it('prints the manual layout line and writes nothing for an unrecognised layout', () => {
    const plan = planNextApp({
      ...app,
      routeExists: true,
      config: undefined,
      layout: { path: 'apps/web/app/layout.tsx', text: 'export default 1;\n' },
    });
    expect(plan.writes.map((write) => write.path)).toEqual(['apps/web/next.config.mjs']);
    expect(plan.printed[0]).toBe(
      "apps/web: apps/web/app/layout.tsx left as it is (unrecognised layout shape); add <Passback /> inside <head> by hand: import { Passback } from '@passback/next'",
    );
  });
});
