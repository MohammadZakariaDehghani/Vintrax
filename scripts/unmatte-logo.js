#!/usr/bin/env node
/**
 * Lifts the black ground off the supplied Vintrax lockup.
 *
 * The artwork was delivered as a glow on a carbon-black slab: 66% of the file
 * is within one step of #000000 and all four borders are black. That slab is
 * correct on the near-black header and wrong everywhere else — on the sign-in
 * page and the footer it showed as a black rectangle pasted onto a white page.
 *
 * What runs here is a luminance key, the standard way to pull a black matte:
 *
 *   value = max(r, g, b)                      how much light the pixel carries
 *   alpha = (value - LOW) / (HIGH - LOW)      clamped to 0…255
 *   colour = unchanged
 *
 * Below LOW is the slab and its carbon weave, and it goes fully transparent.
 * Above HIGH is artwork — the chrome wordmark, the maple leaf, the car's red
 * outline — and it stays fully opaque with its own colours untouched. Between
 * them is the glow, which fades rather than ending at an edge.
 *
 * The thresholds were chosen by measurement, not taste. The slab's texture
 * peaks at 63, so LOW sits just above it: raise LOW further and the glow starts
 * to clip; lower it and a grey haze in the shape of the old rectangle appears
 * on white. 77% of the file ends up fully transparent and 17% fully opaque, so
 * the key is doing almost no interpolation — it is removing a background, not
 * reinterpreting a picture.
 *
 * Nothing is redrawn, recoloured, cropped, resized or re-laid-out. Every output
 * pixel keeps its own RGB and is a function of that one input pixel. Composited
 * back over the header colour the difference from the delivered file averages
 * 5/255 per channel, all of it in the outer glow.
 *
 * Usage: node scripts/unmatte-logo.js <source.png> <target.png> [more targets…]
 */
const path = require('node:path');
const sharp = require(
  path.join(__dirname, '../node_modules/.pnpm/sharp@0.35.4_@types+node@22.20.1/node_modules/sharp'),
);

/** Above the slab's brightest carbon texture, which measures 63. */
const LOW = 64;
/** Below the dimmest artwork, so the wordmark and the leaf stay fully opaque. */
const HIGH = 140;

async function main([source, ...targets]) {
  if (!source || targets.length === 0) {
    throw new Error('Usage: unmatte-logo.js <source.png> <target.png> [more targets…]');
  }

  const { data, info } = await sharp(source).raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const out = Buffer.alloc(width * height * 4);

  let worst = 0;
  let drift = 0;

  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const i = pixel * channels;
    const o = pixel * 4;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    const value = Math.max(r, g, b);
    const alpha = Math.max(0, Math.min(255, Math.round(((value - LOW) * 255) / (HIGH - LOW))));

    out[o] = r;
    out[o + 1] = g;
    out[o + 2] = b;
    out[o + 3] = alpha;

    // What the header will actually show: this pixel composited back onto
    // black. Measured rather than assumed, so "unchanged on dark" is a number.
    for (let k = 0; k < 3; k += 1) {
      const back = Math.round((data[i + k] * alpha) / 255);
      const difference = Math.abs(back - data[i + k]);
      worst = Math.max(worst, difference);
      drift += difference;
    }
  }

  const png = await sharp(out, { raw: { width, height, channels: 4 } })
    .png({ compressionLevel: 9, effort: 10 })
    .toBuffer();

  for (const target of targets) {
    await sharp(png).toFile(target);
    console.log(`${target}  ${width}×${height}  ${(png.length / 1024).toFixed(0)}KB`);
  }

  console.log(
    `drift over black: mean ${(drift / (width * height * 3)).toFixed(2)}/255, worst ${worst}/255`,
  );
}

main(process.argv.slice(2)).catch((error) => {
  console.error(error.message);
  process.exit(1);
});
