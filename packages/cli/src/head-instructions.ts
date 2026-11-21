const FRAMEWORKS: { names: string[]; lines: (dir: string) => string[] }[] = [
  {
    names: ['@sveltejs/kit'],
    lines: (dir) => [
      `${dir}: manually edit src/routes/+layout.svelte; pages show the widget only after this helper call.`,
      `${dir}: import { passbackHeadHtml } from '@passback/vite-plugin/head' in the component script; add <svelte:head>{@html passbackHeadHtml()}</svelte:head> outside the script.`,
    ],
  },
  {
    names: ['astro'],
    lines: (dir) => [
      `${dir}: manually edit your layout's <head> (for example src/layouts/Layout.astro); pages show the widget only after this helper call.`,
      `${dir}: import { passbackHeadHtml } from '@passback/vite-plugin/head' in the frontmatter; add <Fragment set:html={passbackHeadHtml()} /> inside <head>.`,
    ],
  },
  {
    names: ['nuxt'],
    lines: (dir) => [
      `${dir}: manually edit app/app.vue; pages show the widget only after this helper call.`,
      `${dir}: import { passbackHead } from '@passback/vite-plugin/head' in <script setup>; add const tags = passbackHead(); useHead({ script: tags.filter(t => t.tag === 'script').map(t => ({ ...t.attrs, ...(t.children === undefined ? {} : { innerHTML: t.children }) })), meta: tags.filter(t => t.tag === 'meta').map(t => t.attrs) });`,
    ],
  },
  {
    names: ['@react-router/dev', 'react-router'],
    lines: (dir) => [
      `${dir}: manually edit app/root.tsx Layout's <head>; pages show the widget only after this helper call.`,
      `${dir}: import { passbackHead } from '@passback/vite-plugin/head'; add {passbackHead().map(({ tag: Tag, attrs, children }, i) => <Tag key={i} {...attrs} {...(children === undefined ? {} : { dangerouslySetInnerHTML: { __html: children } })} />)} inside Layout's <head>.`,
    ],
  },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function dependencyNames(packageJson: unknown): Set<string> {
  const names = new Set<string>();
  if (!isRecord(packageJson)) {
    return names;
  }
  for (const field of ['dependencies', 'devDependencies']) {
    const deps = packageJson[field];
    if (isRecord(deps)) {
      Object.keys(deps).forEach((name) => names.add(name));
    }
  }
  return names;
}

/** The two manual-edit lines for the first matching server-rendered framework, or none. */
export function headInstructions(dir: string, packageJson: unknown): string[] {
  const names = dependencyNames(packageJson);
  const match = FRAMEWORKS.find((f) => f.names.some((n) => names.has(n)));
  return match === undefined ? [] : match.lines(dir);
}
