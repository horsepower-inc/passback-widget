import { describe, expect, it } from 'vitest';
import { wrapNextConfig } from './next-config';

const IMPORT = "import { withPassback } from '@passback/next';";
const REQUIRE = "const { withPassback } = require('@passback/next');";

function wrap(text: string, root = '../..'): string {
  const result = wrapNextConfig(text, root);
  if (!result.ok) throw new Error(result.reason);
  return result.text;
}

describe('wrapNextConfig', () => {
  it('wraps export default <identifier> and adds the import after the last import', () => {
    const text = "import a from 'a';\nimport b from 'b'\n\nconst config = {};\nexport default config;\n";
    expect(wrap(text)).toBe(
      `import a from 'a';\nimport b from 'b'\n${IMPORT}\n\nconst config = {};\nexport default withPassback(config, { root: '../..' });\n`,
    );
  });

  it('wraps the argument of export default fn(identifier)', () => {
    const out = wrap("import x from 'x';\nconst config = {};\nexport default withNextIntl(config);\n");
    expect(out).toContain("export default withNextIntl(withPassback(config, { root: '../..' }));");
  });

  it('wraps module.exports = <identifier> and requires withPassback', () => {
    const out = wrap("const a = require('a');\nconst config = {};\nmodule.exports = config;\n");
    expect(out).toBe(
      `const a = require('a');\n${REQUIRE}\nconst config = {};\nmodule.exports = withPassback(config, { root: '../..' });\n`,
    );
  });

  it('wraps module.exports = fn(identifier)', () => {
    const out = wrap('const config = {};\nmodule.exports = withX(config);\n');
    expect(out).toBe(
      `${REQUIRE}\nconst config = {};\nmodule.exports = withX(withPassback(config, { root: '../..' }));\n`,
    );
  });

  it('wraps an export default object literal that runs to the end of the file', () => {
    const out = wrap("import a from 'a';\nexport default {\n  images: { unoptimized: true },\n};\n");
    expect(out).toBe(
      `import a from 'a';\n${IMPORT}\nexport default withPassback({\n  images: { unoptimized: true },\n}, { root: '../..' });\n`,
    );
    expect(wrap('module.exports = { a: 1 }')).toContain(
      "module.exports = withPassback({ a: 1 }, { root: '../..' });",
    );
  });

  it('puts the import at the top when the file has none', () => {
    expect(wrap('const c = {};\nexport default c;\n')).toBe(
      `${IMPORT}\nconst c = {};\nexport default withPassback(c, { root: '../..' });\n`,
    );
  });

  it('leaves a config that already mentions withPassback unchanged and reports no change', () => {
    const text = `${IMPORT}\nexport default withPassback(c, { root: '.' });\n`;
    expect(wrapNextConfig(text, '../..')).toEqual({ ok: true, changed: false, text });
  });

  it('refuses a shape it does not recognise and says why', () => {
    const reason = 'unrecognised next.config shape';
    for (const text of [
      'export default config satisfies NextConfig;\n',
      'export default function () { return {}; }\n',
      'export default async function config() {}\n',
      'const a = 1;\n',
      '',
    ]) {
      expect(wrapNextConfig(text, '.')).toEqual({ ok: false, reason });
    }
  });

  it('refuses an object literal that is followed by more code', () => {
    expect(wrapNextConfig('export default { a: 1 };\nconsole.log({});\n', '.').ok).toBe(false);
    expect(wrapNextConfig('module.exports = { a: 1 }\nfoo({ b: 2 })\n', '.').ok).toBe(false);
  });

  it('writes the root option exactly as given', () => {
    expect(wrap('export default c;\n', '../../..')).toContain("{ root: '../../..' }");
    expect(wrap('export default c;\n', '.')).toContain("{ root: '.' }");
  });
});
