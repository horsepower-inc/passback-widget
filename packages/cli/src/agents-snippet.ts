export const SNIPPET_START = '<!-- passback:start -->';
export const SNIPPET_END = '<!-- passback:end -->';

export const HOSTED_LINES: readonly string[] = [
  '## Hosted Passback',
  '',
  'Only when the developer asks to set up hosted Passback (comments from a deployed or staging',
  'site), run these from the project root. Each takes `--json` and then prints one JSON line',
  'per step.',
  '',
  '1. `npx passback login` prints a code and opens the browser; the developer clicks Approve.',
  '   Never ask the developer for a token or paste one yourself.',
  '2. `npx passback init --site` creates the site for this project and writes its site key,',
  '   endpoint and a mode line into the plugin options: comments go to you, the agent, while the',
  '   dev server runs, and to the tracker from deployed builds. Leave that line as it is unless',
  '   the developer asks to change it (`agent`, `relay` or `off`).',
  '3. `npx passback connect linear` (or `github`) prints an address and opens the browser; the',
  '   developer approves Passback in Linear or installs the Passback GitHub App, then the command',
  '   saves where comments go and files a test comment. When it lists several choices, run it',
  '   again with `--to` and one of them. For Plane, or when the developer prefers a key, add',
  '   `--key <key>` with the key the developer gives you (`plane` also needs `--workspace <slug>`).',
  '   `plane` also takes `--intake`, which files marks in Intake.',
  '',
  '`npx passback site delete <name> --yes` deletes a site. Run it only for a site the developer',
  'named in this conversation.',
];

const BODY =
  '## Passback\n' +
  '\n' +
  'Marks made in the browser reach you through the `passback` MCP server (`passback dev`). ' +
  'When the developer starts a Passback session (`/passback` in Claude Code, `$passback` in Codex), call `passback_wait`, fix each mark it returns (a mark with a `reopened` field came back from the reporter), ' +
  'report progress with `passback_status` (`running`, then `done` or `failed`), and call `passback_wait` again.' +
  '\n\n' +
  'Passback is not set up from a template. Before you edit any file, settle with the developer which environments get the widget (local dev, staging, production or none; production only if they allow it), which mode each uses (`agent`, `relay` or `off`; `stagingModes` names the build modes that ship the widget), where it sits on the page (`corner`, pages to leave out) and where comments go. Propose defaults from the repo (build modes, deploy environments) and ask. Never just run `npx passback init` and stop.' +
  '\n\n' +
  'Hosted Passback, only when the developer asks for it: `npx passback login`, then `npx passback init --site`, then `npx passback connect <linear|github>` (the developer approves in the browser) or `npx passback connect plane --workspace <slug> --key <key> --intake`. `--intake` files marks in Plane Intake (use `--no-intake` for work items); `npx passback site delete <name> --yes` only for a site the developer named. Each takes `--json`.';

const BLOCK = `${SNIPPET_START}\n${BODY}\n${SNIPPET_END}`;

export interface MergeAgentsSnippetResult {
  changed: boolean;
  text: string;
}

/** Pure merge of the passback AGENTS.md block into an existing AGENTS.md text. */
export function mergeAgentsSnippet(existing: string | undefined): MergeAgentsSnippetResult {
  const trimmed = existing?.trim() ?? '';
  if (trimmed === '') {
    return { changed: true, text: BLOCK + '\n' };
  }

  const text = existing as string;
  const startIdx = text.indexOf(SNIPPET_START);
  const endIdx = text.indexOf(SNIPPET_END);

  if (startIdx === -1 && endIdx === -1) {
    const appended = text.replace(/\n+$/, '') + '\n\n' + BLOCK + '\n';
    return { changed: true, text: appended };
  }

  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    throw new Error('invalid AGENTS.md: markers must be a matching start followed by an end');
  }

  const before = text.slice(0, startIdx);
  const after = text.slice(endIdx + SNIPPET_END.length);
  const merged = before + BLOCK + after;

  return { changed: merged !== text, text: merged };
}
