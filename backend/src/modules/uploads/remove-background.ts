import sharp, { type OutputInfo } from 'sharp';

/** How far a pixel's colour may sit from the background's and still count as background, per channel sum. */
const TOLERANCE = 60;

/** Below this share of the frame, what was found is not a backdrop but a few pale pixels at the edge. */
const MIN_BACKGROUND_SHARE = 0.05;

/** The longest side the result is kept to. A body-type shortcut is drawn a few centimetres wide. */
const MAX_SIDE = 1200;

/**
 * Cuts a vehicle out of a flat backdrop, for the body-type shortcuts on the
 * home page, which are drawn as icons rather than framed photographs.
 *
 * A studio shot of a car on white (or any single flat colour) becomes a PNG
 * with that backdrop transparent. The backdrop is found from the frame's
 * corners, and removed by flooding inward from the edges, never by colour
 * alone: a white car on a white backdrop keeps its white body, because the
 * body is not connected to the edge through backdrop-coloured pixels.
 *
 * Returns null, leaving the upload to be stored exactly as sent, when there
 * is no flat backdrop to remove: the corners disagree (a photograph of a
 * scene), the image is already transparent, or too little of the frame
 * matched to be a backdrop. Also null when the file cannot be decoded; the
 * storage service's own validation then answers that.
 */
export async function removeFlatBackground(input: Buffer): Promise<Buffer | null> {
  let decoded: { data: Buffer; info: OutputInfo };
  try {
    decoded = await sharp(input, { limitInputPixels: 60_000_000 })
      .rotate()
      .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
  } catch {
    return null;
  }

  const { data, info } = decoded;
  const { width, height } = info;
  const channels = 4;
  const at = (x: number, y: number) => (y * width + x) * channels;

  const corners = [at(0, 0), at(width - 1, 0), at(0, height - 1), at(width - 1, height - 1)];
  // Already cut out: nothing to do, and flooding would eat the anti-aliased edge.
  if (corners.some((offset) => data[offset + 3]! < 250)) return null;

  const background = [0, 1, 2].map(
    (channel) => corners.reduce((sum, offset) => sum + data[offset + channel]!, 0) / 4,
  ) as [number, number, number];
  const distance = (offset: number) =>
    Math.abs(data[offset]! - background[0]) +
    Math.abs(data[offset + 1]! - background[1]) +
    Math.abs(data[offset + 2]! - background[2]);

  // Four corners that do not agree are a scene, not a backdrop.
  if (corners.some((offset) => distance(offset) > TOLERANCE)) return null;

  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;
  const push = (x: number, y: number) => {
    const index = y * width + x;
    if (visited[index]) return;
    visited[index] = 1;
    if (distance(index * channels) <= TOLERANCE) queue[tail++] = index;
  };

  for (let x = 0; x < width; x += 1) {
    push(x, 0);
    push(x, height - 1);
  }
  for (let y = 0; y < height; y += 1) {
    push(0, y);
    push(width - 1, y);
  }

  while (head < tail) {
    const index = queue[head++]!;
    data[index * channels + 3] = 0;
    const x = index % width;
    const y = (index - x) / width;
    if (x > 0) push(x - 1, y);
    if (x < width - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < height - 1) push(x, y + 1);
  }

  if (tail / (width * height) < MIN_BACKGROUND_SHARE) return null;

  return sharp(data, { raw: { width, height, channels } }).png({ compressionLevel: 9 }).toBuffer();
}
