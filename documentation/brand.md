# Brand

The Vintrax identity, and the constraints it has to satisfy.

## Two shapes, not one

The identity has a **lockup** and an **icon**, and they are deliberately not
the same artwork.

```
brand/vintrax-logo-source.png          The lockup exactly as supplied
frontend/public/vintrax-logo.png       The lockup, black ground keyed off
mobile/public/vintrax-logo.png         The same file, for the mobile app
scripts/unmatte-logo.js                Derives the second from the first
frontend/src/components/logo.tsx       <Logo>     the lockup — header, footer, sign-in
                                       <LogoMark> the icon
mobile/src/components/logo.tsx         <Logo>     the lockup — sign-in
                                       <LogoMark> the icon
frontend/src/app/icon.svg              Favicon and web app icon
mobile/public/icons/icon.svg           Mobile app icon
mobile/public/icons/icon-maskable.svg  Launcher icon, croppable
```

### The lockup

`frontend/public/vintrax-logo.png` — the supplied artwork, a 1989×790 PNG: a
car in profile in red chrome over a chrome **VINTRAX.ca** wordmark, with a
maple leaf at the left, on a carbon-fibre ground.

The artwork is rendered **as delivered**, with one deliberate exception: its
background. Nothing recolours it, crops it, resizes it, adds an effect to it,
or redraws it, and `w-auto` against a fixed height keeps the file's own aspect
ratio at every breakpoint. `<Logo>` shows it in the page header, the footer,
the web sign-in page and the mobile sign-in screen.

It is served through `next/image` from a static import. That is a delivery
decision, not an edit: Next emits correctly sized WebP derivatives per
breakpoint rather than sending the full PNG to a phone on every page. The same
file ships at `mobile/public/vintrax-logo.png` for the mobile app, and the two
are byte-identical.

#### The black ground, and why it is gone

The file arrived as a glow on a solid carbon-black slab. On the near-black
header that is invisible and correct. On the footer and the sign-in page, which
are light, it read as a black rectangle pasted onto a white page.

`scripts/unmatte-logo.js` keys the ground off with a luminance key — alpha
ramps from nothing at max-channel 64 to fully opaque at 140, and every pixel
keeps its own RGB. The thresholds are measured, not chosen: the slab's carbon
texture peaks at 63, so the low end sits just above it. 77% of the file ends up
fully transparent and 17% fully opaque, so almost nothing is interpolated — the
key removes a background, it does not reinterpret a picture. Composited back
onto the header colour, the difference from the delivered file averages 5/255
per channel, all of it in the outer glow.

The file exactly as supplied is kept at `brand/vintrax-logo-source.png`, so the
step is reproducible and the original is never lost:

```bash
node scripts/unmatte-logo.js brand/vintrax-logo-source.png \
  frontend/public/vintrax-logo.png mobile/public/vintrax-logo.png
```

One consequence to know. The wordmark is **chrome**, which is a treatment built
for a dark ground: on the header it is crisp, and on a white surface it is
legible but low-contrast. That is a property of the artwork, not of the key,
and the only fix is a light-background variant from whoever drew it. Do not
recolour this one to make it read — see _What to avoid_.

### The icon

A browser tab is 16 pixels. The lockup's tapered outlines close into a smudge
well before that, and a 2:1 lockup cannot be squared for a PWA icon or cropped
to a circle for a launcher. So the icon is a **solid silhouette** of the same
car: Kamm tail, cabin set into the rear third, a long raked screen over a low
nose.

Every icon variant is the same geometry. Five rules produced it:

- **Legible at 16px.** A browser tab is 16 pixels. The window line and the gap
  between tyre and arch both close up below about 32px, so neither is drawn —
  what remains is the stance.
- **The artwork bleeds past the tile.** A car in profile is roughly 2.4:1.
  Centred at its natural size inside a square it leaves so much empty tile that
  the mark vanishes in a tab, so it is drawn oversize and allowed to run off the
  left and right edges. The maskable variant is the exception and scales _down_
  instead — see below.
- **The arches are cut, not painted.** They are subpaths of the body path
  resolved with `fill-rule="evenodd"`. Discs filled in the background colour
  would only work where the surface behind them is known, and the `plain`
  variant is used on surfaces that are not.
- **No font dependency.** The mark is paths, so it renders identically wherever
  it lands rather than substituting whatever font is installed.
- **Survives a circular crop.** Android masks launcher icons to whatever shape
  the device prefers, so the maskable variant scales the artwork to sit inside
  the safe zone — the middle 80% — and lets the background bleed to the full
  square. The bleed that makes the web icon work would cost it the nose and the
  tail here.

## Colour

| Token    | Value                | Use                                                       |
| -------- | -------------------- | --------------------------------------------------------- |
| Carbon   | `#100d0d`            | The tile, the masthead band, the manifest's `theme_color` |
| Red      | `#ed1d1d`            | The car, and `--accent` at its light-theme value          |
| Deep red | `--primary`          | Buttons, links, active navigation                         |
| Grey     | `--muted-foreground` | The lockup's descriptor and secondary text                |
| White    | `#ffffff`            | Text on carbon and on `--primary`                         |

**Carbon frames, red carries.** The mark is a red car on near-black, and the
interface follows: the masthead is carbon, and every action is red.

`--primary` is a _much_ darker red than the mark's `#ed1d1d` — `0 75% 42%`,
which is 6.4:1 against white. The mark's red is chosen to glow on near-black
and would fail badly as a button colour under white text.

The fixed hexes exist because `frontend/src/app/icon.svg`, the mobile icons and
the manifest are static files that cannot read a CSS custom property. They
carry the same values the tokens hold, by hand; changing one means changing
both.

### Red, and everything else that is red

**This replaces the previous rule.** The identity used to be green, which let
red mean "error" and nothing else. A red brand gives that up, and pretending
otherwise would be worse than saying it plainly:

`--primary`, `--accent` and `--destructive` are now all red. Hue can no longer
separate an action from a failure, so **lightness and saturation do**, and they
are set far enough apart to be told apart at a glance:

| Token           | Light theme | Reads as                                  |
| --------------- | ----------- | ----------------------------------------- |
| `--primary`     | `0 75% 42%` | The action. Mid-dark, fully saturated.    |
| `--accent`      | `0 85% 52%` | The brand and live auctions. Brightest.   |
| `--destructive` | `0 52% 30%` | Failure. Darkest and dullest on the page. |

This is weaker than a hue difference, and it is not relied on alone. The rule
the rest of this document already followed does the real work: **colour is
never the only signal.** Errors carry an icon and explicit wording, and so do
success states — which is also how `--success` (green) and `--primary` stay
distinct now that they no longer share a hue.

- **The price flash stays amber**, not red. With three reds already on the
  page, a fourth would be indistinguishable from all of them.
- **Red as a large surface is still avoided.** Buttons, rules and the masthead
  band, not backgrounds.

> This inverts the earlier "Actions are never red" rule, which existed only
> because the brand was green. It is recorded here rather than deleted so the
> reason the rule changed is not lost.

## In the applications

```tsx
<Logo className="h-[54px]" />  // the lockup, sized by height only
<LogoMark />                   // the icon tile
<LogoMark plain />             // no tile, car in currentColor
```

`<Logo>` takes a height and nothing else. Never give it a width or a
`w-` class: `w-auto` is what holds the supplied file's aspect ratio, and
setting both dimensions is how a logo gets stretched. There is no `tone` —
there is one file and it is transparent, so what varies is the surface behind
it, which belongs to the page.

### Supplying different artwork

To swap the lockup without touching code, put the new file in
`frontend/public/` and set **`NEXT_PUBLIC_BRAND_LOGO_SRC`** to its path:

```bash
NEXT_PUBLIC_BRAND_LOGO_SRC=/some-other-logo.png
```

`<Logo>` then renders that file instead, everywhere. Two consequences to know
about. It is a `NEXT_PUBLIC_*` value, so it is compiled into the bundle and
changing it is a rebuild, not a restart — it is wired through
`infrastructure/docker/frontend.Dockerfile` as a build argument and
`.github/workflows/release.yml` as the repository variable of the same name.
And an overridden path has no intrinsic size known at build time, so it is
served as a plain `<img>` rather than through `next/image`: supply a file that
is already the right size.

The favicon and the PWA icons are separate files and are **not** affected by
that variable.

**The tile uses fixed hex values, not theme tokens.** `--primary` and
`--primary-foreground` swap in dark mode, so a tile built from them inverts and
stops matching the app icon, which is a static file. The identity looks the
same in both themes; only the `plain` variant follows its surface.

These are inline SVG rather than `<img>` so `plain` can inherit that colour at
all: dark mode here is a class on `<html>`, and an image file can only see the
OS preference.

## The name

**VINTRAX**, with the descriptor **Auto sales and auctions** —
_Ventes et enchères automobiles_ in French.

The descriptor is live text rather than part of an image, which is what lets it
translate at all. A flat logo file would have pinned the site to one language in
a country with two.

> The source logo supplied for the rebrand reads "VINTRAX AUTOSALES". The
> descriptor here says _auctions_ as well, because auctions are half the
> platform and [D-004](./decision-log.md) turns on Vintrax being a place where
> dealerships and private sellers both list. Narrowing the descriptor to
> "Autosales" alone would read as a single dealership to the dealers being asked
> to put inventory here.

## What to avoid

Learned from earlier drafts:

- **Wide lockups as the app icon.** A 2.5:1 lockup cannot be squared for a PWA
  icon or cropped to a circle for a launcher. The icon is the mark alone, and
  even then it has to be bled to fill the square.
- **Gradients, bevels and photographic texture in the _icon_.** The lockup has
  all three — a carbon weave, a chrome wordmark, a lens flare — and keeps them,
  because it is the supplied artwork and is shown at a size that carries them.
  None survive being a 16px favicon, which is why `LogoMark` is a separate
  drawing that keeps the subject and drops the treatment.
- **Redrawing the lockup.** It is a supplied file. Recolouring it to follow a
  theme, cropping it to fit a slot, or tracing it as SVG are all ways of
  shipping something that is not the logo.
- **A baked-in background on _either_ shape.** A mark carrying its own
  background sits as a slab on the opposite theme — which is why `plain` exists
  on the icon, and why the lockup's black ground was keyed off rather than
  lived with. Re-flattening the lockup onto black to "fix" its contrast on a
  light page brings the rectangle back.
- **Red as a large surface.** It reads as a warning, not as a brand. This is
  the one rule the red identity did _not_ relax: the brand is a red mark and
  red controls on carbon and white, never a red page.
