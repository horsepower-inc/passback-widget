import { z } from 'zod';

// prettier-ignore
export const CUSTOMER_TRACKERS = [
  'linear', 'plane', 'github', 'azure-devops', 'gitlab', 'trello', 'notion', 'asana', 'jira', 'clickup'] as const;
export const Tracker = z.enum(CUSTOMER_TRACKERS);
export type Tracker = z.infer<typeof Tracker>;

export const Credential = z.string().min(8).max(512);
export type Credential = z.infer<typeof Credential>;

export const WorkspaceSlug = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
export type WorkspaceSlug = z.infer<typeof WorkspaceSlug>;

const PlaneAddressShape = /^https:\/\/[A-Za-z0-9.-]+\/?$/;
const HostLabel = /^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
const LocalSuffix = /\.(local|localhost|internal|localdomain)$/i;

export function isPlaneHost(address: string): boolean {
  const labels = address.slice('https://'.length).replace(/\/$/, '').split('.');
  return (
    labels.length >= 2 &&
    labels.every((l) => HostLabel.test(l)) &&
    /[A-Za-z]/.test(labels[labels.length - 1] ?? '') &&
    !LocalSuffix.test(labels.join('.'))
  );
}

export const PlaneAddress = z
  .string()
  .max(253)
  .refine((v) => PlaneAddressShape.test(v) && isPlaneHost(v), { message: 'invalid address' });
export type PlaneAddress = z.infer<typeof PlaneAddress>;

export const GithubRepo = z
  .string()
  .max(140)
  .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
export type GithubRepo = z.infer<typeof GithubRepo>;

export const ClickupListId = z.string().regex(/^\d{1,20}$/);
export type ClickupListId = z.infer<typeof ClickupListId>;

export const GitlabProject = z
  .string()
  .max(255)
  .regex(/^(?:[0-9]+|[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+)$/);
export type GitlabProject = z.infer<typeof GitlabProject>;

export const JiraCloudId = z.string().regex(/^[0-9A-Fa-f]{8}(-[0-9A-Fa-f]{4}){3}-[0-9A-Fa-f]{12}$/);
export type JiraCloudId = z.infer<typeof JiraCloudId>;

export const JiraProjectKey = z.string().regex(/^[A-Z][A-Z0-9_]{1,9}$/);
export type JiraProjectKey = z.infer<typeof JiraProjectKey>;

export const AsanaGid = z.string().regex(/^\d{1,32}$/);
export type AsanaGid = z.infer<typeof AsanaGid>;

export const NotionDataSourceId = z
  .string()
  .regex(/^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{32})$/i);
export type NotionDataSourceId = z.infer<typeof NotionDataSourceId>;

export const TrelloId = z.string().regex(/^[0-9a-f]{24}$/);
export type TrelloId = z.infer<typeof TrelloId>;

export const AdoProjectId = z
  .string()
  .regex(/^[0-9A-Fa-f]{8}(-[0-9A-Fa-f]{4}){3}-[0-9A-Fa-f]{12}$/);
export type AdoProjectId = z.infer<typeof AdoProjectId>;

export const AdoWorkItemType = z.enum(['Bug', 'Task']);
export type AdoWorkItemType = z.infer<typeof AdoWorkItemType>;

export const GithubSink = z.literal('github-pr');
export type GithubSink = z.infer<typeof GithubSink>;

export const TargetId = z.string().min(1).max(128);

export const VerifyRequest = z.discriminatedUnion('tracker', [
  z.strictObject({ tracker: z.literal('linear'), credential: Credential }),
  z.strictObject({
    tracker: z.literal('plane'),
    credential: Credential,
    workspace: WorkspaceSlug,
    planeUrl: PlaneAddress.optional(),
  }),
  z.strictObject({
    tracker: z.literal('github'),
    credential: Credential,
    sink: GithubSink.optional(),
  }),
  z.strictObject({ tracker: z.literal('jira'), credential: Credential }),
  z.strictObject({
    tracker: z.literal('azure-devops'),
    credential: Credential,
    workspace: WorkspaceSlug,
  }),
  z.strictObject({
    tracker: z.literal('gitlab'),
    credential: Credential,
    gitlabUrl: PlaneAddress.optional(),
  }),
  z.strictObject({ tracker: z.literal('trello'), credential: Credential }),
  z.strictObject({ tracker: z.literal('notion'), credential: Credential }),
  z.strictObject({ tracker: z.literal('asana'), credential: Credential }),
  z.strictObject({ tracker: z.literal('clickup'), credential: Credential }),
]);
export type VerifyRequest = z.infer<typeof VerifyRequest>;

export const SaveIntegration = z.discriminatedUnion('tracker', [
  z.strictObject({
    tracker: z.literal('linear'),
    credential: Credential,
    project: TargetId,
    projectId: TargetId.optional(),
  }),
  z.strictObject({
    tracker: z.literal('plane'),
    credential: Credential,
    workspace: WorkspaceSlug,
    planeUrl: PlaneAddress.optional(),
    project: TargetId,
    intake: z.boolean().optional(),
  }),
  z.strictObject({
    tracker: z.literal('github'),
    credential: Credential,
    project: GithubRepo,
    sink: GithubSink.optional(),
  }),
  z.strictObject({
    tracker: z.literal('jira'),
    credential: Credential,
    cloudId: JiraCloudId,
    project: JiraProjectKey,
  }),
  z.strictObject({
    tracker: z.literal('azure-devops'),
    credential: Credential,
    workspace: WorkspaceSlug,
    project: AdoProjectId,
    workItemType: AdoWorkItemType.optional(),
  }),
  z.strictObject({
    tracker: z.literal('gitlab'),
    credential: Credential,
    gitlabUrl: PlaneAddress.optional(),
    project: GitlabProject,
  }),
  z.strictObject({
    tracker: z.literal('trello'),
    credential: Credential,
    boardId: TrelloId,
    project: TrelloId,
  }),
  z.strictObject({
    tracker: z.literal('notion'),
    credential: Credential,
    project: NotionDataSourceId,
  }),
  z.strictObject({
    tracker: z.literal('asana'),
    credential: Credential,
    workspace: AsanaGid,
    project: AsanaGid,
  }),
  z.strictObject({
    tracker: z.literal('clickup'),
    credential: Credential,
    project: ClickupListId,
  }),
]);
export type SaveIntegration = z.infer<typeof SaveIntegration>;

export const UpdateIntegration = z.discriminatedUnion('tracker', [
  z.strictObject({
    tracker: z.literal('linear'),
    project: TargetId,
    projectId: TargetId.optional(),
  }),
  z.strictObject({
    tracker: z.literal('plane'),
    project: TargetId,
    intake: z.boolean().optional(),
  }),
  z.strictObject({ tracker: z.literal('github'), project: GithubRepo }),
  z.strictObject({ tracker: z.literal('jira'), cloudId: JiraCloudId, project: JiraProjectKey }),
  z.strictObject({
    tracker: z.literal('azure-devops'),
    project: AdoProjectId,
    workItemType: AdoWorkItemType.optional(),
  }),
  z.strictObject({ tracker: z.literal('gitlab'), project: GitlabProject }),
  z.strictObject({ tracker: z.literal('trello'), boardId: TrelloId, project: TrelloId }),
  z.strictObject({ tracker: z.literal('notion'), project: NotionDataSourceId }),
  z.strictObject({ tracker: z.literal('asana'), workspace: AsanaGid, project: AsanaGid }),
  z.strictObject({ tracker: z.literal('clickup'), project: ClickupListId }),
]);
export type UpdateIntegration = z.infer<typeof UpdateIntegration>;
