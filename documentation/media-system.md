# The media system: hero, blog, home features and home boxes

How pictures and videos reach the home page: the media library, the
"presentation" each piece of content stores, how it is drawn and animated,
and what protecting a video can and cannot mean. Decision: D-062.

## What was there before, and what was kept

The audit this was planned from found most of the parts already in place,
and they are reused rather than replaced:

| Existing piece                                                                                  | Where                                                                       | Reused for                                       |
| ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------ |
| Photo pipeline: bytes checked, decoded once with a pixel budget, metadata stripped, WebP widths | `backend/src/modules/vehicle-images/image-processor.ts`                     | Every library picture                            |
| Chunked video upload sessions, ffmpeg re-encode, poster frame                                   | `uploads/promo-video-uploads.service.ts`, `common/media/video-processor.ts` | Every library video (now with a phone rendition) |
| `StorageService` / `ImageStorage`: generated keys, signature checks, local or S3                | `common/storage/`                                                           | All files                                        |
| `content:manage` permission, audit log, Redis-cached public reads                               | throughout                                                                  | All new endpoints                                |
| Blog posts (`Article`), Home features (`HomeFeature`), Home boxes (`PromoTile`)                 | their modules                                                               | Upgraded in place — no content recreated         |

The front end gained no framework and no animation library: React server
components, CSS, and one `IntersectionObserver`.

## The model

**Media asset** (`MediaAsset` table, Admin → Media library). One uploaded file:

- **picture** — WebP renditions at the `IMAGE_VARIANT_WIDTHS` (320–1920),
  plus AVIF when `IMAGE_AVIF_ENABLED`. The original is not kept.
- **video** — silent H.264 MP4 (≤1920 wide, ≤30 s, `+faststart`), a WebP
  poster frame, and a ≤720-wide phone rendition. The upload is not kept.

It also stores a name and a default description. Storage keys are recorded
so the files can be deleted, and never leave the API.

**Media presentation** (`MediaPresentation` in `@vintrax/shared`): how one
piece of content shows media. It is stored as JSON in a `media` column on
`Article`, `HomeFeature`, `PromoTile` and `HomeHero`.

| Field                | Meaning                                                                                                                                |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `kind`               | `IMAGE` or `VIDEO`                                                                                                                     |
| `desktop` / `mobile` | Snapshots of a library asset's public URLs. `mobile` is optional; without it phones get `desktop`, or for a video its phone rendition. |
| `alt`                | Description for screen readers                                                                                                         |
| `fit`                | `COVER` (default) or `CONTAIN`                                                                                                         |
| `position`           | Which part stays in view when cropped (9 choices)                                                                                      |
| `autoplay`, `loop`   | Video playback                                                                                                                         |
| `animation`          | `type` (none, fade, slide up, scale, reveal), `durationMs`, `delayMs`, `onScroll`                                                      |

There is no `muted` switch: the pipeline removes the sound track, which is also
what lets browsers start the video without a click. Active/inactive and order
are the content's own (`enabled`, `status`, `position`, `slot`, `homeOrder`),
as before.

Admins choose assets **by id**; the API fills in the URLs
(`MediaLibraryService.resolve`), so a page can only ever show files Vintrax
stored. Content keeps a snapshot, so the home page never joins tables to draw
itself; an asset still in use (by id or by URL, including the old columns)
cannot be deleted — the API answers 409 naming where it is used.

### Backward compatibility

Every new column is nullable or defaulted (migration
`20261006000000_media_system`). Content saved before has `media = null` and is
drawn exactly from what it had — `articleMedia`, `homeFeatureMedia` and
`promoTileMedia` build a presentation from `heroImageUrl`, `imageUrl`, or a
box's `videoUrl`/`videoPosterUrl`. Nothing needs recreating. A stored value
that fails to parse is treated as no media rather than an error.

A post's `heroImageUrl` stays required and is filled with the photo or the
video's poster, so cards, the blog index, Open Graph tags and anything else
reading it keep working.

## Content

- **Hero** (`/admin/hero`, new): full-width picture or video. It has a
  headline, a line under it, up to two buttons, a shade (0–80 %), left or
  centred text, and a height (medium, large or full screen). **Draft by
  default**: until it is saved as active, the home page leads with the blog
  slideshow exactly as before. Active, it takes that place, and posts still
  appear in the carousel below it.
- **Blog** (`/admin/blog`): each post's picture or video, with its phone
  version, crop and animation. A video post plays in the home banner and on
  the post, and cards show its poster. **Pinned to the top** orders chosen
  published posts ahead of the rest. Without pins the order is newest first,
  as before.
- **Home features** (`/admin/home-features`): new fields are a line above the
  text, the media editor, and a layout. _Beside the text_ is the original
  card. _Full width_ is a cinematic band with the words over the media.
  Draft or active, and reordering with arrows, as before.
- **Home boxes** (`/admin/promo-tiles`): any number up to 12 (three are
  always offered). Each can have a title, a line of text and a button label
  over the media, as real text. Arrow buttons move boxes; delete closes the
  gap. Width and height work as before.

Every editor has a **live preview** at computer and phone width. It is a
same-origin frame of `/admin/preview` that renders the real home page
components, so breakpoints, phone media, crops and animations are the
site's own. A "Replay animation" button replays the entrance.

## Rendering

| Component                                                                                     | Role                                                                                                                                   |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `components/media/responsive-media.tsx`                                                       | One entry point: chooses picture or video. Add new media kinds here.                                                                   |
| `media-image.tsx`                                                                             | `<picture>` with a phone `<source media>`, AVIF, a WebP `srcset`, width and height reserved. Lazy unless `priority`. Server component. |
| `video-background.tsx`                                                                        | The video behaviour described below.                                                                                                   |
| `media-style.ts`                                                                              | Fit, position, and `revealProps()`, which returns the `data-reveal` attributes.                                                        |
| `scroll-reveal-observer.tsx`                                                                  | One observer for the whole site, mounted in the root layout.                                                                           |
| `scroll-progress.tsx`                                                                         | The progress bar.                                                                                                                      |
| `home-hero.tsx`, `home-features.tsx`, `promo-tiles.tsx`, `home-masthead.tsx`, `blog-card.tsx` | Consumers                                                                                                                              |

### Video behaviour

- **Lazy:** `preload="none"`; `play()` is called only when 25 % of the video is
  on screen. It pauses when scrolled away or when the tab is hidden.
- **Right-sized:** a phone plays the mobile video, else the phone rendition
  (in the tests: 118 KB against 740 KB for the desktop file).
- **Data Saver or 2G:** no autoplay.
- **Reduced motion:** no autoplay; the poster shows, with a play button.
- **Hidden slideshow slides:** held paused.
- **Never a blank box:** the poster is a responsive picture under the video.
  It is the LCP element for the hero, and it remains if the video fails.
- **Pause control:** a small pause/play button on hero, masthead, post and
  feature videos (WCAG 2.2.2). Boxes have none, because a box is itself a
  link.

## Motion

- **Entrances:** an element carries `data-reveal="fade|slide-up|scale|reveal"`
  plus duration and delay variables, and is revealed once as it scrolls into
  view. Rows stagger by 90 ms, up to 450 ms. Only `opacity`, `transform` and
  `clip-path` animate, so nothing re-lays out.
- **The hero settles in on load:** pure CSS (`hero-enter`), so it starts
  before any script runs.
- **Safe without JavaScript:** waiting content is hidden only under
  `@media (scripting: enabled)`. It shows by itself after 2.5 s unless the
  observer has taken charge, so a failed script never leaves the page blank.
- **Reduced motion:** none of it applies. The observer reveals everything
  immediately, the hero does not animate, and videos do not autoplay.
- **Scroll progress:** a 3 px bar above the header, using one passive scroll
  listener throttled to `requestAnimationFrame`, drawn with `scaleX`. It takes
  no clicks and is exposed as a labelled progressbar.
- **Smooth scrolling:** native `scroll-behavior: smooth` for in-page links,
  with no-preference only. There is no scroll-jacking and no library.
  `data-scroll-behavior="smooth"` lets Next jump instantly on route changes.

GSAP, Lenis and Three.js were not added: every effect asked for is a CSS
transition triggered by an `IntersectionObserver`.

## Video protection, and its limits

What is done:

- Background videos have no native controls, so there is no download button
  or menu.
- `controlsList="nodownload noplaybackrate noremoteplayback nofullscreen"`,
  `disablePictureInPicture` and `disableRemotePlayback` are set.
- The context menu is suppressed on the video element.
- Files have random UUID names, and the original upload is never stored or
  served — only the re-encoded file.

What this cannot do: **any video a browser can play can be saved by its
viewer.** The URL is visible in developer tools and the network log, and
screen recording works on anything shown on a screen. These measures stop
casual "right-click, save video", nothing more.

Infrastructure: storage is a public folder (local) or a public bucket URL
(S3). There are no signed URLs, and adding them would only shorten how long a
copied link works, not prevent copying. DRM (Widevine or FairPlay with
encrypted HLS/DASH) is the only stronger option. It was not added, since
nothing in the deployment requires it, and it would mean a licensed packager
and a streaming player. If it is ever needed, it goes into `VideoBackground`
and the upload pipeline, behind the same `MediaPresentation`.

## Security

- **Permissions:** every admin and upload endpoint requires `content:manage`
  (tested: anonymous and dealer get 403). The public endpoints return only
  active content (`GET /home-hero` is null while the hero is a draft).
- **Pictures:** recognised by their bytes, not their name or declared type,
  and refused below 320×180 or above the configured dimension and pixel
  budget. They are re-encoded, so no uploaded byte is served.
- **Videos:**
  - Only MP4, MOV, WebM and Matroska are announced.
  - Pieces are size-checked.
  - ffmpeg reads with `-protocol_whitelist file` and a format allowlist, and
    arguments are passed without a shell.
  - The output is re-encoded with metadata removed.
- **Files:**
  - Names are generated.
  - Keys are validated against path traversal.
  - Files go to the `media/` folder, served read-only with immutable caching.
  - Labels from filenames are sanitised.
- **Content URLs:** come only from library ids. Plain URLs (old content) must
  pass `StorageService.isOwnUrl`.
- **Live preview:** accepts messages only from its own origin and parent, and
  fetches nothing.

  The CSP `frame-src` now includes `'self'` so the admin can frame its own
  preview. `frame-ancestors 'self'` still prevents other sites framing Vintrax.

## Limits

- Pictures are stored at most 1920 px wide (`IMAGE_MAX_WIDTH`), which is soft
  on 4K and 5K screens at full width. Raise it, and add a width to
  `IMAGE_VARIANT_WIDTHS`, if that matters.
- Videos are capped at 30 s and 100 MB (`PROMO_VIDEO`). They are processed in
  the API process, and sessions live in memory, as before (one API instance).
- Videos are H.264 MP4 only. Every current mainstream browser plays them.
  Open-source Chromium builds (such as the Playwright browser used in CI)
  cannot, and show the poster.
- Snapshots do not follow later edits to an asset's description. Re-choose
  the asset to refresh them.
