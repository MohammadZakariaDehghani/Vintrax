# Brand

The Vintrax identity, and the constraints it has to satisfy.

## The mark

A red **summit** crossed by a **road** sweeping to the horizon, on the brand
navy — the lockup's two shapes, reduced to what survives at small sizes.

```
frontend/src/app/icon.svg              Favicon and web app icon
mobile/public/icons/icon.svg           Mobile app icon
mobile/public/icons/icon-maskable.svg  Launcher icon, croppable
frontend/src/components/logo.tsx       In-app mark and lockup
mobile/src/components/logo.tsx         In-app mark
```

Every version is the same geometry. Four rules produced it:

- **Legible at 16px.** A browser tab is 16 pixels. The full lockup's notch in
  the peak and the hairline taper of the road both disappear below about 48px,
  so neither is drawn — what remains is the silhouette.
- **No font dependency.** The mark is paths, so it renders identically wherever
  it lands rather than substituting whatever font is installed.
- **Survives a circular crop.** Android masks launcher icons to whatever shape
  the device prefers, so the maskable variant scales the artwork to sit inside
  the safe zone and lets the background bleed to the full square.
- **Holds its shape when small.** An earlier draft used a thinner road, closer
  to the lockup. It dissolved at 24px and left a red smudge. The road here is
  deliberately fatter than the print original.

## Colour

| Token | Value                | Use                                                 |
| ----- | -------------------- | --------------------------------------------------- |
| Navy  | `#16295c`            | The tile, `--primary`, the manifest's `theme_color` |
| Red   | `#d32027`            | The peak, `--accent`                                |
| Grey  | `--muted-foreground` | The lockup's descriptor and secondary text          |
| White | `#ffffff`            | The road, and text on navy                          |

**Navy carries the product; red is a note, not a wash.** The lockup is roughly
85% navy, and the interface follows: buttons, links and active navigation are
navy. Red appears on the live-auction badge, the rule beneath the hero, and the
mark itself.

### Red and errors

Red is the brand colour _and_ the colour of a failed bid. That collision is
real, and it is resolved by role rather than by hoping people notice a hue
difference:

- **Actions are never red.** The hero search, "contact seller" and bidding
  buttons are navy. So a red control is not a thing the interface has.
- **The price flash is amber**, not red. It used to be red, two elements above
  a red bid-rejection message.
- **`--destructive` is darker and less saturated** than the brand red, and
  error states always carry an icon and explicit wording as well as colour.

That last point is the one that actually does the work. Colour is never the
only signal.

## In the applications

```tsx
<LogoMark />                       // the tile, for a neutral surface
<LogoMark plain />                 // no tile, road in currentColor
<Logo descriptor={t.brand.descriptor} />  // the full lockup
```

**The tile uses fixed hex values, not theme tokens.** `--primary` and
`--primary-foreground` swap in dark mode, so a tile built from them inverts and
stops matching the app icon, which is a static file. The identity looks the
same in both themes; only the `plain` variant follows its surface.

These are inline SVG rather than `<img>` so `plain` can inherit that colour at
all: dark mode here is a class on `<html>`, and an image file can only see the
OS preference.

## The name

**VINTRAX**, with the descriptor **Canada's auto marketplace** —
_Le marché automobile du Canada_ in French.

The descriptor is live text rather than part of an image, which is what lets it
translate at all. A flat logo file would have pinned the site to one language in
a country with two.

It says _marketplace_, not _dealership_. Vintrax is where dealerships and private
sellers list to buyers ([D-004](./decision-log.md)); a dealer deciding whether
to put inventory here should not see what looks like a competitor at the top of
the page.

## What to avoid

Learned from earlier drafts:

- **Wide lockups as the app icon.** A 2.5:1 lockup cannot be squared for a PWA
  icon or cropped to a circle for a launcher. The icon is the mark alone.
- **A baked-in background.** A logo carrying its own background sits as a slab
  on the opposite theme.
- **Gradients, bevels and photographic texture.** They force a raster file and
  disappear at the sizes where the mark is actually used.
- **Red as a large surface.** The hero briefly graduated navy → red across half
  the screen. It read as a warning, not as a brand.
