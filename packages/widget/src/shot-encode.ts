export const SHOT_MAX_BYTES = 524288;
export const SHOT_PAD = 24;
export const SHOT_MAX_WIDTH = 1200;
export const SHOT_MAX_HEIGHT = 800;
export const SHOT_QUALITIES = [0.8, 0.65, 0.5] as const;

type Box = { x: number; y: number; width: number; height: number };

export function cropRect(el: Box, viewport: { width: number; height: number }): Box | undefined {
  const left = Math.max(0, Math.floor(el.x - SHOT_PAD));
  const top = Math.max(0, Math.floor(el.y - SHOT_PAD));
  const right = Math.min(viewport.width, Math.ceil(el.x + el.width + SHOT_PAD));
  const bottom = Math.min(viewport.height, Math.ceil(el.y + el.height + SHOT_PAD));
  if (right <= left || bottom <= top) return undefined;
  return {
    x: left,
    y: top,
    width: Math.min(right - left, SHOT_MAX_WIDTH),
    height: Math.min(bottom - top, SHOT_MAX_HEIGHT),
  };
}

export function imageMime(blobType: string): 'image/webp' | 'image/png' | undefined {
  return blobType === 'image/webp' || blobType === 'image/png' ? blobType : undefined;
}

type Encoded = {
  blob: Blob;
  mime: 'image/webp' | 'image/png';
  quality: number;
  scale: number;
};

export async function encodeWithinCap(
  encode: (quality: number, scale: number) => Promise<Blob | null>,
  maxBytes = SHOT_MAX_BYTES,
): Promise<Encoded | undefined> {
  for (const scale of [1, 0.5]) {
    for (const quality of SHOT_QUALITIES) {
      const blob = await encode(quality, scale);
      const mime = blob ? imageMime(blob.type) : undefined;
      if (blob && mime && blob.size <= maxBytes) return { blob, mime, quality, scale };
      if (mime === 'image/png') break;
    }
  }
  return undefined;
}
