# Brand

The Vintrax identity, and the constraints it has to satisfy.

## Two shapes, not one

The identity has a **lockup** and an **icon**, and they are deliberately
different drawings of the same car.

```
frontend/src/components/logo.tsx       <Logo>     the lockup — header, footer, sign-in
                                       <LogoMark> the icon
mobile/src/components/logo.tsx         <LogoMark> the icon
frontend/src/app/icon.svg              Favicon and web app icon
mobile/public/icons/icon.svg           Mobile app icon
mobile/public/icons/icon-maskable.svg  Launcher icon, croppable
```

### The lockup

The brand as supplied: a car drawn in **tapered sweeps** over the **VINTRAX**
wordmark in chrome over **AUTOSALES** in green. This is what the page header
shows.

The car is seven filled crescents rather than stroked paths, because the source
artwork's strokes are thick through the middle and come to a point at each end,
and an SVG stroke cannot taper.

AUTOSALES is part of the artwork, not a translated descriptor. The previous
identity carried a translated line under the wordmark; this one does not, which
is why `<Logo>` no longer takes a `descriptor`. The translatable tagline still
sits beside the lockup in the footer, where it is prose rather than part of the
mark.

**The wordmark is set, not drawn as outlines**, with `textLength` pinning its
width. Whichever face the browser actually has, the lockup keeps its
proportions and nothing around it moves. Drawing seven letterforms as paths
would remove the font dependency entirely, and is the upgrade to make if the
substituted faces ever look wrong.

**Every chrome stop is light.** On the header band the wordmark sits at about
14px, and a chrome ramp with a genuinely dark mid-band cuts the glyphs in half
at that size — it reads as damage, not as metal. The contrast _between_ stops
is what says polished; the absolute darkness is not, and it costs legibility.
The green edge is 3 units in a 780-wide viewBox for the same reason: thicker
and the wordmark reads green rather than silver once it is small.

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

| Token      | Value                | Use                                                       |
| ---------- | -------------------- | --------------------------------------------------------- |
| Carbon     | `#0c1210`            | The tile, the masthead band, the manifest's `theme_color` |
| Green      | `#21c45d`            | The car                                                   |
| Deep green | `--primary`          | Buttons, links, active navigation                         |
| Grey       | `--muted-foreground` | The lockup's descriptor and secondary text                |
| White      | `#ffffff`            | Text on carbon and on `--primary`                         |

**Carbon frames, green carries.** The mark is a green car on near-black, and
the interface follows: the masthead is carbon, and every action is green.

`--primary` is a _much_ darker green than the mark's `#21c45d` — `148 78% 22%`,
which is 7.3:1 against white. The mark's green is chosen to glow on near-black
and would fail badly as a button colour under white text.

### Green and success

Brand green and `--success` are both green, which is a real collision and is
resolved the way every other colour collision here is: **colour is never the
only signal.** Success states carry an icon and explicit wording, so a reader
who cannot separate the two hues still gets the message. Actions are green;
confirmations are green _and_ say so.

### Red and errors

Red is no longer a brand colour, which removes a collision the previous
identity had to work around. `--accent` keeps it for live-auction moments, and
`--destructive` keeps it for failure, darker and less saturated so the two are
distinguishable on the same screen.

- **Actions are never red.** The hero search, "contact seller" and bidding
  buttons are green. A red control is not a thing the interface has.
- **The price flash is amber**, not red, so it never sits two elements above a
  red bid-rejection message.

## In the applications

```tsx
<Logo tone="onDark" className="h-[54px]" />  // the lockup on the header band
<Logo />                                     // the lockup on a light surface
<LogoMark />                                 // the icon tile
<LogoMark plain />                           // no tile, car in currentColor
```

`tone="onDark"` is what gives the wordmark its chrome, and it needs a dark
surface behind it — the same gradient on white is nearly invisible. The default
`auto` sets the whole lockup in the theme's own colours instead: the car and
wordmark in `--primary`, AUTOSALES in `--muted-foreground`.

### Using the supplied artwork instead

The lockup above is a drawing of the supplied logo, not the file itself: the
original is a raster with a carbon-fibre weave, a chrome bevel and a lens
flare, none of which survive being scaled down to a header.

To use the real file, put it in `frontend/public/` and set
**`NEXT_PUBLIC_BRAND_LOGO_SRC`** to its path:

```bash
NEXT_PUBLIC_BRAND_LOGO_SRC=/vintrax-logo.png
```

`<Logo>` then renders that image everywhere instead. Two consequences to know
about. It is a `NEXT_PUBLIC_*` value, so it is compiled into the bundle and
changing it is a rebuild, not a restart. And an image carries its own
background, so it only sits correctly on the carbon band — the light-surface
variant in the footer and on the sign-in page will show a dark slab. Supply a
transparent PNG or SVG if those matter.

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
- **Gradients, bevels and photographic texture.** The source logo has all three
  — a carbon-fibre weave, a chrome wordmark and a lens flare. None of them
  survive being a favicon, and each forces a raster file. The mark here keeps
  the _subject_ and the _colour_ and drops the treatment.
- **A baked-in background.** A logo carrying its own background sits as a slab
  on the opposite theme, which is why `plain` exists.
- **Red as a large surface.** It reads as a warning, not as a brand.
