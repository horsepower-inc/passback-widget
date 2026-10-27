// Plane-only parts of passback connect: the Intake switch and the workspace message.

import { adoMissingOrganization } from './connect-ado';
import type { ConnectArgs } from './args-connect';
import type { Failure } from './hosted';

type ConnectTracker = ConnectArgs['tracker'];
type ConnectOptions = Pick<ConnectArgs, 'tracker' | 'workspace'>;

/** `intake` goes to the api only for Plane and only when the person passed a flag. */
export function intakeFields(opts: { tracker: string; intake?: boolean }): { intake?: boolean } {
  return opts.tracker === 'plane' && opts.intake !== undefined ? { intake: opts.intake } : {};
}

export function intakeNotEnabled(tracker: ConnectTracker): Failure {
  return {
    code: 'intake_not_enabled',
    message: `That ${tracker === 'plane' ? 'Plane' : 'tracker'} project has Intake switched off. In Plane, open the project settings and turn on Intake, then run the command again.`,
  };
}

export function missingWorkspace(opts: ConnectOptions): string {
  if (opts.tracker === 'azure-devops') return adoMissingOrganization(opts.workspace);
  return `Plane has no workspace "${opts.workspace}" for that key.`;
}

/** The 422 answers that name a Plane workspace or the Intake switch. */
export function planeFailure(code: string | undefined, opts: ConnectOptions): Failure | undefined {
  if (code === 'workspace_not_found') return { code, message: missingWorkspace(opts) };
  if (code === 'intake_not_enabled') return intakeNotEnabled(opts.tracker);
  return undefined;
}
