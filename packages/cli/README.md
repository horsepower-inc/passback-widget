# passback

Passback lets you point at something wrong in your running app and have your
coding agent fix it.

## What it does

- You open your app in the browser and mark an element, with a short comment.
- Your coding agent gets the report: your comment, the page, the element and,
  when it can be found, the file and line of the code behind it.
- The agent fixes the code and reports progress back to the mark in the browser.
- You check the result in the browser and mark the next thing.

This package is the command line tool. It connects your project and your coding
agent (Claude Code, Codex or Cursor) to Passback, and signs you in when you use
the hosted service.

## Quick start (local mode)

No account and no login. For a Vite project:

```sh
npm i -D passback @passback/vite-plugin
npx passback init --apply
npm run dev
```

Restart your agent, approve the `passback` server when it asks, then type
`/passback` (in Codex, `$passback`). Open your app, mark an element, write what
is wrong and send it. The agent picks the mark up.

## Two ways to use it

### Local mode (no account)

This is what `npx passback init` sets up, and what the plugin does by default
under `vite serve`.

- No login and no account: you never run `passback login`.
- Nothing leaves your machine. Marks go from the browser to your dev server and
  are saved in `.passback/inbox` in your project.
- Your agent reads them over MCP, through the `passback` server that `init`
  registered in `.mcp.json` (the agent starts it with `passback dev`).
- It works while the dev server runs. Production builds do not include the widget.

### Relay mode (hosted)

Use this when people on a deployed or staging site should be able to comment,
and you want those comments in your tracker.

- Sign in with `npx passback login`, then create a site with `npx passback init --site`.
  Its site key and endpoint are written into your plugin options.
- Comments go through the hosted Passback relay and are filed in Linear, GitHub
  or Plane. Connect one with `npx passback connect`.
- Comments can carry a screenshot that the commenter draws on.
- `init --site` also writes a mode line: your agent gets the comments while you
  develop, and your tracker gets them from deployed builds.

## Commands

| Command                           | What it does                                 | Needs an account? |
| --------------------------------- | -------------------------------------------- | ----------------- |
| `npx passback init`               | Shows the setup; --apply writes it           | No                |
| `passback dev`                    | Runs the MCP server (your agent starts it)   | No                |
| `npx passback review-pr <n>`      | Posts open marks as a pull request review    | No                |
| `npx passback pr-check`           | Compares two snapshots and lints the layout  | No                |
| `npx passback snapshot`           | Writes a page snapshot for `pr-check`        | No                |
| `passback --version`              | Prints the installed version                 | No                |
| `npx passback login`              | Signs you in to hosted Passback              | Yes               |
| `passback whoami`                 | Prints who you are signed in as              | Yes               |
| `passback logout`                 | Signs you out                                | Yes               |
| `npx passback init --site`        | Creates a hosted site and sets up relay mode | Yes               |
| `npx passback connect`            | Sends a site's comments to your tracker      | Yes               |
| `npx passback site delete <name>` | Deletes a hosted site                        | Yes               |
| `npx passback billing`            | Shows your plan and a payment link           | Yes               |

### `npx passback init`

Sets the project up for the agent, with no account. A bare `npx passback init`
writes only `.passback/inbox`, `.passback/outbox` and the `.passback/` entry in
`.gitignore`, and prints the rest so you can check it. `npx passback init --apply`
writes all of it:

- `.mcp.json`, the MCP server entry for the agent
- an `AGENTS.md` block telling the agent how to read marks
- the `/passback` command and skill for each agent (`--agents claude,codex,cursor`,
  default all)
- `passback()` in your `vite.config` plugins list (it prints what to add when it
  cannot edit the file), or the route and layout tag in a Next.js app

### `passback dev`

Runs the MCP server. The agent launches it from `.mcp.json`; you do not run it
by hand.

### `npx passback login`

Signs you in to hosted Passback. It prints a short code and opens your browser;
click Approve on the page, signed in to the dashboard. The token is saved in
your user config folder (`~/.config/passback/credentials.json`, readable only
by you), never in the project. The `--api` flag, or the `PASSBACK_API_URL`
environment variable, points it at another server. `--json` prints one JSON
line per step, for agents.

### `passback whoami`

Prints the account and organisation you are signed in as. `--json` for agents.

### `passback logout`

Revokes the token on the server and deletes the saved file. `--json` for agents.

### `npx passback init --site`

Creates a hosted site for the project (named after the project folder, allowed
origins taken from its localhost ports), writes its site key, endpoint and
a mode line into the passback() options in vite.config or the Passback tag in
the Next root layout, when that plugin is already in the config (run
`npx passback init --apply` first to add it). The mode line sends comments
to your agent while you develop and to your tracker from deployed builds;
edit it to choose agent, relay or off. Run passback login first. A second run
reuses the site. --json prints one JSON line per step, for agents.

### `npx passback connect linear`

Sends this site's comments to a tracker. For linear and github it prints an
address and opens your browser: approve Passback in Linear, or
install the Passback GitHub App on the repository; then it saves the
destination, files a test comment and prints where comments go. For plane, or
to use a key you made yourself, add --key <key> (plane also needs --workspace
<slug>). For plane, --intake files comments in Plane Intake and --no-intake
files them as work items. With several teams, projects or repositories it lists
them; pass one with --to. --site <name> picks another site. --json for agents.

To move a connected site's comments to another target without pasting a key
again, run `npx passback connect <tracker> --keep-key`. It checks the key the
site already has, lists or picks the target, saves it, files a test comment
and prints where comments go; it never opens the browser for approval.
--keep-key takes --intake and --no-intake too, and keeps the stored choice when
neither is given.
--site <name>, --to <where> and --json work as above, and azure-devops also
takes --type bug|task. --keep-key cannot be combined with --key, --token,
--workspace or --url. If it says the saved key no longer works, run `npx passback connect <tracker>` again with a new key.

### `npx passback site delete <name>`

Deletes a hosted site after you type its name. Its site key stops working and
its tracker connection is removed; comments already filed stay in the
tracker. --yes skips the prompt (for agents); --json for agents.

### `npx passback billing`

Prints the account's state (for example "Trial: 10 days left" or "Paused — pay to turn your sites back on") and a Stripe link: to start paying when no payment is set up, or to manage payment (card, invoices, cancel) when it is. Add `--json` for one JSON line.

Once the account pays, each new site adds $5 a month, so `npx passback init --site` asks for `--yes` before it adds one.

### `npx passback review-pr <n>`

Posts the open comments in `.passback/inbox` as one review on pull request
`<n>`, through the GitHub CLI `gh` you are already signed in with.
`--repo owner/name` names the repository (by default, the one `gh repo view` reports);
`--root <dir>` picks the project folder. `--dry-run` prints the review as JSON
and posts nothing. Comments already posted are not posted twice. A comment
whose file is not in the pull request diff goes into the review body.

With no open comments it prints `no open marks to post` and exits 0; failures
exit 1. In a monorepo whose app lives in a subfolder, every comment lands in
the review body.

### `npx passback pr-check --base <file> --head <file>`

Compares two snapshot files and lints the layout of the head file.
`--assertions <dir>` also checks the assertion files in that folder. It prints
one summary line, `passback pr-check: pass` or `passback pr-check: findings`
with counts, then the changes. `--json` prints one JSON object instead.
Exit code 0 means pass, 1 means findings, and 2 means a file could not be read
or is invalid.

### `npx passback snapshot --url <address> --routes <list> --viewports <list> --out <file>`

Opens each route at each viewport width in Chromium through Playwright, with
animations off, and writes one snapshot file that `pr-check` reads. `--url`
is the site's base address, `--routes` is a comma list of routes starting with
a slash (`/,/pricing`), and `--viewports` is a comma list of widths
(`375,1280`). It needs Playwright (`npm i -D playwright`); without it, the
command prints that hint and exits 2. A page that does not load exits 1 and
names the route and width.

### `passback --version`

Prints the installed version.

## Requirements

Node 22 or newer.

## Links

- [Passback site](https://passback.dev)
- [`@passback/vite-plugin` on npm](https://www.npmjs.com/package/@passback/vite-plugin)
- [Source on GitHub](https://github.com/horsepower-inc/passback-widget)

## License

MIT
