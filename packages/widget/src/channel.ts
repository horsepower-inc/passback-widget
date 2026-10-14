import type { Batch, ChannelAck, ChannelStatus } from '@passback/schema';

export type Hot = {
  send(event: string, data: unknown): void;
  on(event: string, cb: (data: unknown) => void): void;
  off?(event: string, cb: (data: unknown) => void): void;
};

export type ChannelHandlers = {
  onAck(ack: ChannelAck): void;
  onStatus(status: ChannelStatus): void;
};

export type Channel = {
  available: boolean;
  sendMark(batch: Batch): boolean;
  dispose(): void;
};

/** the HMR channel between the widget and the Vite plugin. Never throws into the host page. */
export function createChannel(hot: Hot | undefined, handlers: ChannelHandlers): Channel {
  if (!hot) {
    return {
      available: false,
      sendMark: () => false,
      dispose: () => {},
    };
  }

  let disposed = false;

  function onAck(data: unknown): void {
    if (disposed) return;
    try {
      handlers.onAck(data as ChannelAck);
    } catch {
      // the overlay never throws into the host page
    }
  }

  function onStatus(data: unknown): void {
    if (disposed) return;
    try {
      handlers.onStatus(data as ChannelStatus);
    } catch {
      // the overlay never throws into the host page
    }
  }

  hot.on('passback:ack', onAck);
  hot.on('passback:status', onStatus);

  return {
    available: true,
    sendMark(batch: Batch): boolean {
      if (disposed) return false;
      hot.send('passback:mark', { v: 1, batch });
      return true;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      hot.off?.('passback:ack', onAck);
      hot.off?.('passback:status', onStatus);
    },
  };
}

const ORPHANED_CHUNK = 20;

/** Tells the plugin which marks lost their element, at most 20 ids per message. Never throws into the host page. */
export function sendOrphaned(
  hot: Pick<Hot, 'send'> | undefined,
  markIds: readonly string[],
): boolean {
  if (!hot || markIds.length === 0) return false;
  try {
    for (let i = 0; i < markIds.length; i += ORPHANED_CHUNK) {
      hot.send('passback:orphaned', { v: 1, markIds: markIds.slice(i, i + ORPHANED_CHUNK) });
    }
    return true;
  } catch {
    return false;
  }
}

/** Asks the plugin to reopen a fixed mark with a comment. Never throws into the host page. */
export function sendReopen(
  hot: Pick<Hot, 'send'> | undefined,
  markId: string,
  comment: string,
): boolean {
  if (!hot) return false;
  try {
    hot.send('passback:reopen', { v: 1, markId, comment });
    return true;
  } catch {
    return false;
  }
}

/** Keeps a prUrl only when its scheme is http or https. */
export function safePrUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? url : undefined;
  } catch {
    return undefined;
  }
}
