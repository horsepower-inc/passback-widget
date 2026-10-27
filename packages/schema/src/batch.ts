import { z } from 'zod';
import { Payload } from './payload';

// A send is a Batch; a single mark is a batch of one.

export const MAX_BATCH_MARKS = 20;

export const Batch = z.object({
  schemaVersion: z.literal(1),
  id: z.string().regex(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/),
  title: z.string().optional(),
  target: z.object({ parent: z.string().min(1) }).optional(),
  pullRequest: z.number().int().min(1).max(2_147_483_647).optional(),
  // filing 'one' = file all marks as one tracker item.
  // filing absent = one item per mark.
  filing: z.literal('one').optional(),
  createdAt: z.iso.datetime(),
  marks: z.array(Payload).min(1).max(MAX_BATCH_MARKS),
});

export type Batch = z.infer<typeof Batch>;

/** Validates unknown input against the v1 batch schema; throws a ZodError on mismatch. */
export function parseBatch(input: unknown): Batch {
  return Batch.parse(input);
}
