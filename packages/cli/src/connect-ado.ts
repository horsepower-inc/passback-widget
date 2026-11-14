// Azure DevOps destinations: an organization (the workspace) and one of its projects.

import type { Choice, Target } from './connect-types';

export function adoChoices(targets: Target[], organization?: string): Choice[] {
  return targets.map((target) => ({
    project: target.id,
    where: `${organization} / ${target.label}`,
  }));
}

export function adoAliases(choice: Choice, targets: Target[]): string[] {
  const target = targets.find((entry) => entry.id === choice.project);
  return target ? [target.label] : [];
}

export function adoBody(
  opts: { key: string; workspace?: string; workItemType?: 'Bug' | 'Task' },
  choice: Choice,
): Record<string, unknown> {
  return {
    tracker: 'azure-devops',
    credential: opts.key,
    workspace: opts.workspace,
    project: choice.project,
    ...(opts.workItemType !== undefined && { workItemType: opts.workItemType }),
  };
}

export function adoMissingOrganization(organization?: string): string {
  return `Azure DevOps has no organization "${organization}" for that token.`;
}
