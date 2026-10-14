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

export type MarkId =z.infer<typeof MarkId>;
export type ChannelMark = z.infer<typeof ChannelMark>;
export type ChannelAck = z.infer<typeof ChannelAck>;
export type MarkState = z.infer<typeof MarkState>;
export type ChannelStatus = z.infer<typeof ChannelStatus>;
export type ChannelOrphaned = z.infer<typeof ChannelOrphaned>;
export type ChannelReopen = z.infer<typeof ChannelReopen>;
export type ChannelAnswer = z.infer<typeof ChannelAnswer>;
