# Brand

The Atlas identity, and the constraints it has to satisfy.

## The mark

A white **A** on the brand blue, bound by an amber crossbar.

```
frontend/src/app/icon.svg            Favicon and web app icon
mobile/public/icons/icon.svg         Mobile app icon
mobile/public/icons/icon-maskable.svg  Launcher icon, croppable
frontend/src/components/logo.tsx     In-app mark and wordmark
mobile/src/components/logo.tsx       In-app mark
```

Every version is the same geometry. Four rules produced it:

- **Legible at 16px.** A browser tab is 16 pixels. Anything with fine detail —
  a car silhouette, a chrome bevel, a tagline — is a smudge at that size.
- **No font dependency.** The mark is paths, not text, so it renders identically
  wherever it lands rather than substituting whatever font is installed.
- **Survives a circular crop.** Android masks launcher icons to whatever shape
  the device prefers, so the maskable variant scales the glyph to 80% and lets
  the background bleed to the full square.
- **One tone when it has to be.** The mark still reads with the amber removed,
  which is what makes it usable in a single colour.

## Colour

| Token | Value | Use |
| --- | --- | --- |
| Brand blue | `#1c4c86` | The tile, `--primary`, the manifest's `theme_color` |
| Amber | `#e7aa40` | The crossbar, `--accent` |
| White | `#ffffff` | The glyph |

The icons use the **dark-theme** amber rather than the light-theme value. The
darker amber goes muddy against this blue below about 32px, and an icon is
mostly seen small.

**Red is not a brand colour here.** It is `--destructive`: failed bids, errors,
destructive confirmations. A red brand would compete with the colour that means
"something went wrong" on precisely the screens — live auctions — where that
signal has to be unmistakable.

## In the applications

```tsx
<LogoMark />              // the tile, for a neutral surface
<LogoMark plain />        // monochrome glyph, for a coloured or cramped surface
<Logo />                  // mark plus the name (web)
```

**The tile uses fixed hex values, not theme tokens.** `--primary` and
`--primary-foreground` swap in dark mode, so a tile built from them inverts —
a light tile with a near-black glyph — and stops matching the app icon, which
is a static file. The identity looks the same in both themes; only the `plain`
variant follows its surface, through `currentColor`.

These are inline SVG rather than `<img>` so `plain` can inherit that colour at
all: dark mode here is a class on `<html>`, and an image file can only see the
OS preference.

The name is live text, not outlines — selectable, searchable, and it scales
with the reader's font settings.

The mark appears in the web header and on the mobile sign-in screen. It is
deliberately absent everywhere else in the mobile app: the app icon is the
branding there, and a mark beside "Hello, Jordan" is decoration.

## The name

**Atlas**, alone. No descriptor.

A descriptor like "Autosales" would say *dealership*, and Atlas is a marketplace
where dealerships and private sellers list to buyers
([D-004](./decision-log.md)). A dealer deciding whether to put inventory here
should not see what looks like a competitor at the top of the page.

## What to avoid

Learned from a proposed alternative that failed each of these:

- **Wide lockups as the app icon.** A 2.5:1 wordmark cannot be squared for a
  PWA icon or cropped to a circle for a launcher.
- **A baked-in background.** The logo would sit as a dark slab on the light
  theme. Assets are transparent; the surface underneath supplies the colour.
- **Gradients, bevels and photographic texture.** They force a raster file, and
  they disappear at the sizes where the mark actually gets used.
- **A bar that runs past the letterform.** It was the more distinctive option,
  and it reads as a strikethrough — a poor association on a marketplace where
  listings sell.
