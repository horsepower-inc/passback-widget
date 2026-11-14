// Jira destinations: a site (cloud id) and a project key.

import type { Choice, Target } from './connect-types';

export function jiraChoices(targets: Target[]): Choice[] {
  return targets.flatMap((site) =>
    (site.children ?? []).map((project) => ({
      project: site.id,
      projectId: project.id,
      where: `${site.label} / ${project.label}`,
    })),
  );
}

export function jiraAliases(choice: Choice, targets: Target[]): string[] {
  const site = targets.find((target) => target.id === choice.project);
  const project = site?.children?.find((child) => child.id === choice.projectId);
  if (!site || !project) return [];
  const key = project.label.split('·')[0]!.trim();
  return [key, `${site.label}/${key}`];
}

export function jiraBody(credential: string, choice: Choice): Record<string, unknown> {
  return { tracker: 'jira', credential, cloudId: choice.project, project: choice.projectId };
}
