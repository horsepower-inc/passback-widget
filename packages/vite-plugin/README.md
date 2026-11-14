# @passback/vite-plugin

Passback lets you point at something wrong in your running app and have your
coding agent fix it. This plugin puts the Passback widget into your Vite app and
saves the marks you make.

## What it does

- You open your app under `vite serve` and mark an element, with a short comment.
- The plugin saves the mark in `.passback/inbox/`, with the element, the page and,
  when it can be found, the file and line of the code behind it.
- Your coding agent reads the mark through the Passback MCP server, fixes the
  code and reports back to the mark in the browser.
- You check the result in the browser and mark the next thing.

## Quick start (local mode)

No account and no login. Requires Vite 7 or 8 and Node 22 or later.

```sh
npm i -D passback @passback/vite-plugin
npx passback init --apply
```

`npx passback init --apply` adds the plugin to your `vite.config` and wires your agent.
A bare `npx passback init` only shows what it would write.
To add the plugin by hand, use this:

```ts
// vite.config.ts
import passback from '@passback/vite-plugin';

export default {
  plugins: [passback()],
};
```

Run `vite`, restart your agent and mark something in the app. `passback()` with no
options is local mode under `vite serve`.

## Two ways to use it

### Local mode (no account)

`mode: 'agent'`, and the default under `vite serve`.

- No login, no account, no `siteKey` and no `endpoint`.
- Nothing leaves your machine: marks go from the browser to your dev server and
  are written to `.passback/inbox/`, where your agent reads them over MCP.
- It runs under `vite serve`. A build contains no widget unless you list its Vite
  mode in `stagingModes`.
- Screenshots: set `screenshots: true` to draw on the page. The picture is saved
  next to the mark as `screenshot.png`, on the dev server only.

### Relay mode (hosted)

`mode: 'relay'`, for deployed and staging builds.

- Needs an account and a site: run `npx passback login`, then
  `npx passback init --site`, which writes the `siteKey` and `endpoint` for you.
- Comments go through the hosted Passback relay and are filed in your tracker
  (Linear, GitHub or Plane).
- Screenshots are on by default.

```ts
passback({
  mode: 'relay',
  stagingModes: ['staging'],
  siteKey: '…',
  endpoint: '…',
});
```

A build emits the widget only when its Vite mode is in `stagingModes`; list
`production` too if you collect feedback there.

## A project with several build modes

A project with separate web and Capacitor builds lists each staging mode, so the
widget appears only in staging builds:

```ts
passback({
  mode: 'relay',
  stagingModes: ['web-dev', 'app-dev'],
  siteKey: '…',
  endpoint: '…',
});
```

`siteKey` and `endpoint` are placeholders: replace them with your project's relay
configuration.

A build emits the widget only when its Vite mode is in `stagingModes`, regardless of the plugin’s `mode`.
Any build mode not listed, including `web-prod` and `app-prod`, emits nothing.
A relay build outside the list warns once, naming `stagingModes`.

The first build emits the widget and the second emits none:

```sh
vite build --mode web-dev
vite build --mode web-prod
```

Then check the production output:

```sh
grep -rl passback dist
```

After the production build, this check prints nothing.

## Options

- `mode`: where comments go. `'agent'` sends them to your coding agent through
  `vite serve`; `'relay'` sends them to the hosted Passback relay and your
  tracker, from a build or from `vite serve`, and needs `siteKey` and
  `endpoint`; `'off'` leaves the widget out everywhere. Left out, `vite serve`
  uses the agent, a build with a `siteKey` uses the relay, and a build without
  one contains nothing. `stagingModes` decides which builds get the widget,
  whatever `mode` is. This is Passback's mode, not Vite's `--mode`.
- `siteKey`: the site key from the Passback dashboard. On a Vercel or Netlify
  preview of a pull request, comments from the preview go to that pull request
  without a `#pb-pr` link.
- `endpoint`: the address of the Passback API (for example
  `https://api.example.com`); required for the relay, and Vite stops with an
  error when it is missing.
- `stagingModes`: the build modes (`vite build --mode <name>`) that include the
  widget, in agent and relay mode alike; every other build mode emits nothing.
  Defaults to none.
- `buildId`: an id that ties the marks to a build.
- `screenshots`: `true` or `false`. Lets the person draw on a screenshot. On by
  default in relay mode; in local mode it is available on the dev server only,
  and off unless you set it.
- `theme`: `auto`, `light` or `dark`. Auto takes the opposite tone of your page.
  Defaults to `auto`.
- `main`: a colour written as `#rrggbb`. Colour of pins and the main button.
- `secondary`: a colour written as `#rrggbb`. Colour of the comment box and the
  launcher; the text on it is picked to stay readable.
- `corner`: `bottom-right`, `bottom-left`, `top-right` or `top-left`. Where the
  football sits. Defaults to `bottom-right`.
- `launcher`: `visible` or `hidden`. Hidden shows nothing until you press the
  hotkey. Defaults to `visible`.
- `hotkey`: modifiers and one letter or digit joined by `+`, with `alt`, `ctrl`
  or `meta` among them, for example `ctrl+shift+k`. Starts choosing without the
  mouse. Defaults to `alt+shift+r`. `off` turns it off.
- `hideHotkey`: modifiers and one letter or digit, written like `hotkey`. Hides
  and shows the marks. Defaults to `alt+shift+h`. `off` turns it off.

A value the widget cannot read stops Vite with an error that names the setting.

## Links

- [Passback site](https://passback.dev)
- [`passback` on npm](https://www.npmjs.com/package/passback)
- [Source](https://github.com/horsepower-inc/passback-widget)

## License

MIT
