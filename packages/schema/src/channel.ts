import { z } from 'zod';
import { Batch, MAX_BATCH_MARKS } from './batch';

// The HMR channel between the widget and the Vite plugin.

const ULID = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

export const CHANNEL_EVENTS = {
  mark: 'passback:mark',
  ack: 'passback:ack',
  status: 'passback:status',
  orphaned: 'passback:orphaned',
  reopen: 'passback:reopen',
  answer: 'passback:answer',
  list: 'passback:list',
  items: 'passback:items',
  verdict: 'passback:verdict',
  clear: 'passback:clear',
  cleared: 'passback:cleared',
} as const;

export const MarkId = z.string().regex(ULID);

export const ChannelMark = z.object({
  v: z.literal(1),
  batch: Batch,
});

export const ChannelAck = z.object({
  v: z.literal(1),
  batchId: z.string().regex(ULID),
  accepted: z.array(MarkId),
  trimmed: z.array(MarkId),
  error: z.object({ code: z.string().min(1), message: z.string() }).optional(),
});

export const MarkState = z.enum(['queued', 'running', 'done', 'failed']);

export const ChannelStatus = z.object({
  v: z.literal(1),
  markId: MarkId,
  state: MarkState,
  message: z.string().optional(),
  prUrl: z.url().optional(),
  at: z.iso.datetime(),
});

export const ChannelOrphaned = z.object({
  v: z.literal(1),
  markIds: z.array(MarkId).min(1).max(MAX_BATCH_MARKS),
});

export const ChannelReopen = z.object({
  v: z.literal(1),
  markId: MarkId,
  comment: z.string().trim().min(1).max(4000),
});

export const ChannelAnswer = z.object({
  v: z.literal(1),
  markId: MarkId,
  text: z.string().trim().min(1).max(4000),
});

// The inbox file's statuses and iterations, restated here because schema never imports inbox.
const InboxStatus = z.enum([
  'new',
  'ack',
  'proposed',
  'accepted',
  'verified',
  'declined',
  'withdrawn',
]);

const HumanVerdict = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('accept') }),
  z.object({ kind: z.literal('decline'), reason: z.string() }),
  z.object({ kind: z.literal('comment'), text: z.string() }),
]);

const InboxIteration = z.object({
  n: z.number().int().positive(),
  agent: z.object({ at: z.iso.datetime(), text: z.string() }).optional(),
  human: z.object({ at: z.iso.datetime(), verdict: HumanVerdict }).optional(),
  statuses: ChannelStatus.pick({ state: true, message: true, prUrl: true, at: true })
    .strict()
    .array()
    .optional(),
});

export const InboxItem = z.object({
  id: MarkId,
  batchId: MarkId,
  status: InboxStatus,
  iteration: z.number().int().positive(),
  route: z.string(),
  selector: z.string(),
  comment: z.string(),
  createdAt: z.iso.datetime(),
  iterations: z.array(InboxIteration),
  file: z.string().optional(),
  orphaned: z.boolean().optional(),
  parked: z.boolean().optional(),
  target: z.object({ tag: z.string(), text: z.string() }).optional(),
});

// widget -> integration
export const ChannelList = z.object({ v: z.literal(1) });

// integration -> widget; a complete replacement of the previous snapshot
export const ChannelItems = z
  .object({
    v: z.literal(1),
    items: z.array(InboxItem),
    truncated: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    for (const [i, it] of value.items.entries()) {
      if (seen.has(it.id))
        ctx.addIssue({ code: 'custom', path: ['items', i, 'id'], message: 'duplicate item id' });
      seen.add(it.id);
    }
  });

// widget -> integration
export const ChannelVerdict = z.object({
  v: z.literal(1),
  markId: MarkId,
  verdict: z.enum(['accept', 'withdraw', 'park', 'unpark']),
});

const ClearScope = z.enum(['fixed', 'tracker', 'workspace']);

// widget -> integration; settings (the whole .passback/ folder) only with the workspace scope
export const ChannelClear = z
  .object({
    v: z.literal(1),
    scope: ClearScope,
    settings: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.settings === true && value.scope !== 'workspace')
      ctx.addIssue({
        code: 'custom',
        path: ['settings'],
        message: 'settings is allowed only with the workspace scope',
      });
  });

// integration -> widget; the counts are what was removed
export const ChannelCleared = z.object({
  v: z.literal(1),
  scope: ClearScope,
  comments: z.number().int().nonnegative(),
  attachments: z.number().int().nonnegative(),
  answers: z.number().int().nonnegative(),
  done: z.number().int().nonnegative(),
  settings: z.boolean(),
});

export type MarkId = z.infer<typeof MarkId>;
export type ChannelMark = z.infer<typeof ChannelMark>;
export type ChannelAck = z.infer<typeof ChannelAck>;
export type MarkState = z.infer<typeof MarkState>;
export type ChannelStatus = z.infer<typeof ChannelStatus>;
export type ChannelOrphaned = z.infer<typeof ChannelOrphaned>;
export type ChannelReopen = z.infer<typeof ChannelReopen>;
export type ChannelAnswer = z.infer<typeof ChannelAnswer>;
export type InboxItem = z.infer<typeof InboxItem>;
export type ChannelList = z.infer<typeof ChannelList>;
export type ChannelItems = z.infer<typeof ChannelItems>;
export type ChannelVerdict = z.infer<typeof ChannelVerdict>;
export type ChannelClear = z.infer<typeof ChannelClear>;
export type ChannelCleared = z.infer<typeof ChannelCleared>;
