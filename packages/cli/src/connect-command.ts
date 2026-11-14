import { TRACKER_TRAITS } from '@passback/schema';
import type { AccountDeps } from './account';
import type { ParsedArgs } from './args';
import { runConnect } from './connect';
import { runConnectBrowser } from './connect-browser';
import { runConnectEdit } from './connect-edit';
import { intakeFields } from './connect-plane';

export async function connectCommand(
  parsed: Extract<ParsedArgs, { cmd: 'connect' }>,
  deps: AccountDeps,
): Promise<void> {
  if (parsed.keepKey === true) {
    const { tracker, to, site, workItemType, json } = parsed;
    process.exitCode = await runConnectEdit(
      {
        root: process.cwd(),
        tracker,
        ...(to !== undefined && { to }),
        ...(site !== undefined && { site }),
        ...(workItemType !== undefined && { workItemType }),
        ...intakeFields(parsed),
        json,
      },
      deps,
    );
    return;
  }
  await connectKeyOrBrowser(parsed, deps);
}

async function connectKeyOrBrowser(
  parsed: Extract<ParsedArgs, { cmd: 'connect' }>,
  deps: AccountDeps,
): Promise<void> {
  const { tracker, key, to, workspace, url, site, workItemType, json } = parsed;
  if (key === undefined && TRACKER_TRAITS[tracker].connect === 'browser') {
    process.exitCode = await runConnectBrowser(
      {
        root: process.cwd(),
        tracker: tracker as Parameters<typeof runConnectBrowser>[0]['tracker'],
        to,
        site,
        json,
      },
      deps,
    );
    return;
  }
  process.exitCode = await runConnect(
    {
      root: process.cwd(),
      tracker,
      key: key as string,
      to,
      workspace,
      url,
      site,
      workItemType,
      ...intakeFields(parsed),
      json,
    },
    deps,
  );
}
