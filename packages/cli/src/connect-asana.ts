// Asana destinations: a workspace (gid) and a project (gid).

import type { Choice, Target } from './connect-types';

export function asanaChoices(targets: Target[]): Choice[] {
  return targets.flatMap((workspace) =>
    (workspace.children ?? []).map((project) => ({
      project: workspace.id,
      projectId: project.id,
      where: `${workspace.label} / ${project.label}`,
    })),
  );
}

export function asanaAliases(choice: Choice, targets: Target[]): string[] {
  const workspace = targets.find((target) => target.id === choice.project);
  const project = workspace?.children?.find((child) => child.id === choice.projectId);
  if (!workspace || !project) return [];
  return [project.label, `${workspace.label}/${project.label}`];
}

export function asanaBody(credential: string, choice: Choice): Record<string, unknown> {
  return { tracker: 'asana', credential, workspace: choice.project, project: choice.projectId };
}
