import { describe, expect, it } from 'vitest';
import { headInstructions } from './head-instructions';
import { planViteApp } from './vite-files';

const SVELTE = [
  'app: manually edit src/routes/+layout.svelte; pages show the widget only after this helper call.',
  "app: import { passbackHeadHtml } from '@passback/vite-plugin/head' in the component script; add <svelte:head>{@html passbackHeadHtml()}</svelte:head> outside the script.",
];
const ASTRO = [
  "app: manually edit your layout's <head> (for example src/layouts/Layout.astro); pages show the widget only after this helper call.",
  "app: import { passbackHeadHtml } from '@passback/vite-plugin/head' in the frontmatter; add <Fragment set:html={passbackHeadHtml()} /> inside <head>.",
];
const NUXT = [
  'app: manually edit app/app.vue; pages show the widget only after this helper call.',
  "app: import { passbackHead } from '@passback/vite-plugin/head' in <script setup>; add const tags = passbackHead(); useHead({ script: tags.filter(t => t.tag === 'script').map(t => ({ ...t.attrs, ...(t.children === undefined ? {} : { innerHTML: t.children }) })), meta: tags.filter(t => t.tag === 'meta').map(t => t.attrs) });",
];
const ROUTER = [
  "app: manually edit app/root.tsx Layout's <head>; pages show the widget only after this helper call.",
  "app: import { passbackHead } from '@passback/vite-plugin/head'; add {passbackHead().map(({ tag: Tag, attrs, children }, i) => <Tag key={i} {...attrs} {...(children === undefined ? {} : { dangerouslySetInnerHTML: { __html: children } })} />)} inside Layout's <head>.",
];

describe('headInstructions', () => {
  it('prints the exact SvelteKit head instructions', () => {
    expect(headInstructions('app', { devDependencies: { '@sveltejs/kit': '2' } })).toEqual(SVELTE);
    expect(headInstructions('app', { dependencies: { '@sveltejs/kit': '2' } })).toEqual(SVELTE);
  });

  it('prints the exact Astro head instructions', () => {
    expect(headInstructions('app', { dependencies: { astro: '4' } })).toEqual(ASTRO);
    expect(headInstructions('app', { devDependencies: { astro: '4' } })).toEqual(ASTRO);
  });

  it('prints the exact Nuxt head instructions', () => {
    expect(headInstructions('app', { dependencies: { nuxt: '3' } })).toEqual(NUXT);
    expect(headInstructions('app', { devDependencies: { nuxt: '3' } })).toEqual(NUXT);
  });

  it('prints the exact React Router head instructions', () => {
    expect(headInstructions('app', { dependencies: { 'react-router': '7' } })).toEqual(ROUTER);
    expect(headInstructions('app', { devDependencies: { 'react-router': '7' } })).toEqual(ROUTER);
    expect(headInstructions('app', { dependencies: { '@react-router/dev': '7' } })).toEqual(ROUTER);
    expect(headInstructions('app', { devDependencies: { '@react-router/dev': '7' } })).toEqual(
      ROUTER,
    );
  });

  it('ignores absent malformed and unrelated dependencies', () => {
    expect(headInstructions('app', undefined)).toEqual([]);
    expect(headInstructions('app', null)).toEqual([]);
    expect(headInstructions('app', [])).toEqual([]);
    expect(headInstructions('app', {})).toEqual([]);
    expect(headInstructions('app', { dependencies: ['astro'] })).toEqual([]);
    expect(headInstructions('app', { dependencies: null, devDependencies: 'astro' })).toEqual([]);
    expect(headInstructions('app', { dependencies: { vite: '5', react: '18' } })).toEqual([]);
  });

  it('uses deterministic framework precedence without duplicate instructions', () => {
    const all = {
      dependencies: { 'react-router': '7', nuxt: '3', astro: '4' },
      devDependencies: { '@react-router/dev': '7', '@sveltejs/kit': '2' },
    };
    expect(headInstructions('app', all)).toEqual(SVELTE);
    expect(headInstructions('app', { dependencies: { nuxt: '3', astro: '4' } })).toEqual(ASTRO);
    expect(headInstructions('app', { dependencies: { nuxt: '3', 'react-router': '7' } })).toEqual(
      NUXT,
    );
    expect(
      headInstructions('app', {
        dependencies: { 'react-router': '7' },
        devDependencies: { '@react-router/dev': '7' },
      }),
    ).toEqual(ROUTER);
  });
});

describe('planViteApp head instructions', () => {
  const packageJson = { devDependencies: { astro: '4' } };
  const base = { dir: 'app', rootRelative: '.' };

  it('appends head instructions without changing config writes', () => {
    const editable = { path: 'vite.config.js', text: 'export default {\n  plugins: [],\n};\n' };
    const configured = {
      path: 'vite.config.js',
      text: "import passback from '@passback/vite-plugin';",
    };
    const refused = { path: 'vite.config.js', text: 'export default makeConfig();\n' };

    for (const config of [editable, configured, refused, undefined]) {
      const without = planViteApp({ ...base, config });
      const withHead = planViteApp({ ...base, config, packageJson });
      expect(withHead.writes).toEqual(without.writes);
      expect(withHead.printed).toEqual([...without.printed, ...ASTRO]);
    }
    expect(planViteApp({ ...base, config: editable }).writes).toHaveLength(1);
    expect(planViteApp({ ...base, config: configured }).writes).toEqual([]);
  });
});
