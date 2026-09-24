import sharp from 'sharp';
import { removeFlatBackground } from './remove-background';

/**
 * Body-type icons are drawn with nothing behind them, so a studio shot on a
 * flat backdrop has the backdrop cut away when it is uploaded. Built from
 * generated images so each test states exactly what goes in.
 */

const WHITE = { r: 255, g: 255, b: 255 };

/**
 * A 200×100 "car": a dark body with a white window in it, on `backdrop`. The
 * window is white like the backdrop but enclosed by the body, which is what
 * the flood fill has to respect.
 */
async function carOn(backdrop: { r: number; g: number; b: number }): Promise<Buffer> {
  const body = await sharp({
    create: { width: 120, height: 50, channels: 3, background: { r: 30, g: 30, b: 60 } },
  })
    .composite([
      {
        input: await sharp({
          create: { width: 30, height: 16, channels: 3, background: WHITE },
        })
          .png()
          .toBuffer(),
        left: 45,
        top: 10,
      },
    ])
    .png()
    .toBuffer();

  return sharp({ create: { width: 200, height: 100, channels: 3, background: backdrop } })
    .composite([{ input: body, left: 40, top: 25 }])
    .jpeg({ quality: 95 })
    .toBuffer();
}

async function alphaAt(png: Buffer, x: number, y: number): Promise<number> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return data[(y * info.width + x) * 4 + 3]!;
}

describe('cutting a body-type photo out of its backdrop', () => {
  it('makes a white backdrop transparent and keeps the car', async () => {
    const cut = await removeFlatBackground(await carOn(WHITE));
    expect(cut).not.toBeNull();
    expect((await sharp(cut!).metadata()).format).toBe('png');
    expect(await alphaAt(cut!, 2, 2)).toBe(0);
    expect(await alphaAt(cut!, 100, 95)).toBe(0);
    expect(await alphaAt(cut!, 50, 70)).toBe(255);
  });

  /** A white window, or a white car, is not background: it is not reachable from the edge. */
  it('keeps white inside the car', async () => {
    const cut = await removeFlatBackground(await carOn(WHITE));
    expect(await alphaAt(cut!, 100, 42)).toBe(255);
  });

  it('works on any flat colour, not only white', async () => {
    const cut = await removeFlatBackground(await carOn({ r: 200, g: 220, b: 240 }));
    expect(await alphaAt(cut!, 2, 2)).toBe(0);
    expect(await alphaAt(cut!, 50, 70)).toBe(255);
  });

  it('leaves a photograph of a scene alone', async () => {
    const pixels = Buffer.alloc(200 * 100 * 3);
    for (let i = 0; i < pixels.length; i += 3) {
      pixels[i] = (i / 3) % 200;
      pixels[i + 1] = Math.floor(i / 3 / 200) * 2;
      pixels[i + 2] = 90;
    }
    const scene = await sharp(pixels, { raw: { width: 200, height: 100, channels: 3 } })
      .jpeg()
      .toBuffer();
    expect(await removeFlatBackground(scene)).toBeNull();
  });

  it('leaves an image that is already transparent alone', async () => {
    const transparent = await sharp({
      create: { width: 50, height: 50, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .png()
      .toBuffer();
    expect(await removeFlatBackground(transparent)).toBeNull();
  });

  it('returns null for something that is not an image', async () => {
    expect(await removeFlatBackground(Buffer.from('not an image'))).toBeNull();
  });
});
