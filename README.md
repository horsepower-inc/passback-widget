# Passback widget

Point at what is wrong on your page. Passback turns it into a comment filed in your tracker or sent to your coding agent.

## Local (free)

The Vite quick start:

    npm i -D passback @passback/vite-plugin && npx passback init --apply

Start or restart your dev server. Restart your agent and approve the Passback server. Then use `/passback` in Claude Code or Cursor, or `$passback` in Codex.

## Hosted

    npx passback init --site <key>

Documentation and sign-up: https://passback.dev

## Framework guides

- https://passback.dev/docs/install-vite/
- https://passback.dev/docs/install-vue/
- https://passback.dev/docs/install-svelte-kit/
- https://passback.dev/docs/install-astro/
- https://passback.dev/docs/install-nuxt/
- https://passback.dev/docs/install-react-router/
- https://passback.dev/docs/install-next/

## What is in this repository

- `packages/widget`: the in-page widget that lets a visitor point at an element and leave a comment.
- `packages/schema`: the shared types and the comment payload schema.
- `packages/collectors`: the collectors that gather page context for a comment.
- `packages/cli`: the `passback` command line that sets a project up.
- `packages/vite-plugin`: the Vite plugin that loads the widget in development.
- `packages/next`: the Next.js integration.
- `packages/adapters`: the local adapters that write comments to a folder in your project.
- `packages/daemon`: the local process that serves the inbox to your coding agent.
- `packages/inbox`: the inbox file format.

The hosted relay and its tracker filing code are not in this repository.

The packages are `passback`, `@passback/vite-plugin` and `@passback/next` on npm: https://www.npmjs.com/package/passback

## How it works

1. The widget loads on your page and a visitor points at the element that is wrong.
2. The collectors attach the page context: the element, its text and the visible state.
3. Passback files the comment in your tracker or sends it to your coding agent.

## Licence

MIT. Copyright (c) 2026 Anton Koniushevskii (Passback)

## This repository is a read-only mirror

This repository is generated from a private monorepo. Issues are welcome: open one on GitHub Issues here or write to support@passback.dev. Pull requests are not merged here; code changes are merged upstream. The mirror is regenerated on each push to main that touches mirrored paths, or by manual dispatch.

## Develop

    pnpm install
    pnpm test
    pnpm typecheck

## Third-party notices

- The Passback button draws a football icon taken from Font Awesome 4 (futbol-o) by Dave Gandy, licensed under the SIL Open Font License 1.1: https://scripts.sil.org/OFL
- The Clear all button draws the eraser icon from Font Awesome Free 6.5.2 (svgs/solid/eraser.svg) by Fonticons, Inc., licensed under CC BY 4.0: https://creativecommons.org/licenses/by/4.0/
