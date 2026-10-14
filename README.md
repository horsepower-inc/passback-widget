# Passback widget

Point at what is wrong on your page. Passback turns it into a comment filed in your tracker or sent to your coding agent.

## What is in this repository

- `packages/widget`: the in-page widget that lets a visitor point at an element and leave a comment.
- `packages/schema`: the shared types and the comment payload schema.
- `packages/collectors`: the collectors that gather page context for a comment.

## Install

    npx passback init --site <key>

The packages are `passback` and `@passback/vite-plugin` on npm: https://www.npmjs.com/package/passback

Documentation and sign-up: https://passback.dev

## How it works

1. The widget loads on your page and a visitor points at the element that is wrong.
2. The collectors attach the page context: the element, its text and the visible state.
3. Passback files the comment in your tracker or sends it to your coding agent.

## Licence

MIT. Copyright (c) 2026 Anton Koniushevskii (Passback)

## This repository is a read-only mirror

This repository is generated from a private monorepo and is overwritten on every release. Issues are welcome: open one on GitHub Issues here or write to support@passback.dev. Pull requests are not merged here; changes are applied upstream.

## Develop

    pnpm install
    pnpm test
    pnpm typecheck

## Third-party notices

- The Passback button draws a football icon taken from Font Awesome 4 (futbol-o) by Dave Gandy, licensed under the SIL Open Font License 1.1: https://scripts.sil.org/OFL
- The Clear all button draws the eraser icon from Font Awesome Free 6.5.2 (svgs/solid/eraser.svg) by Fonticons, Inc., licensed under CC BY 4.0: https://creativecommons.org/licenses/by/4.0/
