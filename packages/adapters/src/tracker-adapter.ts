// the TrackerAdapter interface and its companion types.

import type { Batch, Payload } from '@passback/schema';

export type Ref = { id: string; url?: string };
export type Attachment = { name: string; path: string };
export type Unsubscribe = () => void;

export interface TrackerAdapter {
  createParent(batch: Batch): Promise<Ref>;
  createIssue(
    payload: Payload,
    opts?: { parent?: Ref; batch?: Batch; payloadUrl?: string },
  ): Promise<Ref>;
  attach(ref: Ref, file: Attachment): Promise<void>;
  onStatusChange(ref: Ref, cb: (status: string) => void): Unsubscribe;
  /** Resolves the status `onStatusChange` would report next for `ref`; rejects for a ref no `createIssue` returned. */
  getStatus?(ref: Ref): Promise<string>;
  /** Appends `text` (redacted first) as a comment on the issue `ref` names; rejects for a ref no `createIssue` returned. */
  comment?(ref: Ref, text: string): Promise<void>;
}
