# Vehicle Images

How a dealer's photo becomes the images the site serves (issue #74,
[D-049](./decision-log.md#d-049--vehicle-photos-are-rendered-once-at-upload)).

## Architecture

```text
Dealer (web form, mobile PWA, CSV feed importer)
  ↓  multipart upload, one file per request, capped by IMAGE_MAX_UPLOAD_BYTES
API — POST /uploads/images, POST|PUT /vehicles/:id/images
  ↓  authentication (JWT) → permission (vehicle:write) → ownership (per vehicle)
Validation — ImageProcessor.validate(): type from the bytes, size, dimensions
  ↓
VehicleImageAsset row (PROCESSING)
  ↓
ImageProcessor.process(): decode once → orient → sRGB → resize → encode
  ↓
ImageStorage (LocalImageStorage today) — variants public, original private
  ↓
VehicleImageAsset row (READY: widths, formats, dimensions)
  ↓
Vehicle API — images[].optimized, primaryImage
  ↓
Frontend — <OptimizedImage>: <picture>, srcset, sizes, width/height
```

| Piece                  | Where                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------ |
| `ImageProcessor`       | `backend/src/modules/vehicle-images/image-processor.ts` — buffer in, buffers out           |
| `VehicleImagesService` | `backend/src/modules/vehicle-images/vehicle-images.service.ts` — validate, record, store   |
| `ImageStorage`         | `backend/src/common/storage/image-storage.ts` — `LocalImageStorage`, `S3ImageStorage`      |
| `ImageBackfill`        | `backend/src/modules/vehicle-images/image-backfill.ts` — `images:migrate`                  |
| `OptimizedImage`       | `frontend/src/components/optimized-image.tsx`, `mobile/src/components/optimized-image.tsx` |

Controllers only receive the file and call the service. `ImageProcessor` knows
nothing about HTTP, the database or storage, which is what lets the same code
run in an upload request, in `images:migrate`, and later in a background worker.

## Processing flow

1. **Validate, before decoding a pixel.** The type is read from the file's
   own bytes with a header-only read; the filename, extension and declared MIME
   type are ignored. Refused with a 400 the uploader can read: an empty or
   unreadable file, anything not JPEG/PNG/WebP/AVIF (SVG, HEIC, executables,
   text), a file over `IMAGE_MAX_UPLOAD_BYTES`, a longest side over
   `IMAGE_MAX_INPUT_DIMENSION`, or more than `IMAGE_MAX_INPUT_PIXELS` pixels.
   The pixel check is the decompression-bomb guard — a 30 KB PNG can declare
   a 20 000 × 20 000 canvas — and libvips enforces the same limit again at
   decode.
2. **Record** a `VehicleImageAsset` row with status `PROCESSING` and the
   original's dimensions and size.
3. **Process**, at most `IMAGE_PROCESSING_CONCURRENCY` photos at a time per
   API process (a waiting upload holds only its compressed bytes). The photo
   is decoded **once**: EXIF orientation applied, converted to sRGB, fitted
   inside `IMAGE_MAX_WIDTH` × `IMAGE_MAX_HEIGHT` without enlarging, as a raw
   bitmap. Every variant is encoded from that bitmap. A truncated or corrupt
   file fails here, is refused with a 400, and leaves no files behind.
4. **Store** the original (private) and every variant through `ImageStorage`.
5. **Record** `READY` with the widths, formats and display dimensions, and
   return them.

Metadata never reaches a variant: pixels go through a raw bitmap, so EXIF
(GPS position, camera serial numbers), XMP and the orientation tag are all
gone. The original keeps its EXIF, which is why it is not publicly served.

Every step is logged with the image id, vehicle id (where known), status,
the failing variant and the duration — never the file's contents or a
credential:

```text
image 1f33…c96c READY vehicle=- 6000x4899 jpeg 5121KB -> 320/640/960/1440/1920 webp in 961ms
image 7a0e…11d2 FAILED vehicle=08c3…bf variant=640.webp after 212ms: …
```

## Supported formats

| Input                | Accepted | Notes                                                                                                                                                                                                                                   |
| -------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| JPEG                 | ✅       |                                                                                                                                                                                                                                         |
| PNG                  | ✅       | Transparency is kept.                                                                                                                                                                                                                   |
| WebP                 | ✅       | First frame of an animation.                                                                                                                                                                                                            |
| AVIF                 | ✅       | The upload form already accepted it.                                                                                                                                                                                                    |
| HEIC / HEIF (HEVC)   | ❌       | The bundled libvips cannot decode HEVC (patent licensing); adding it means a custom libvips build. iPhones convert to JPEG when a browser uploads a photo, so the common case never sends HEIC. Refused with a message asking for JPEG. |
| SVG, GIF, TIFF, etc. | ❌       | Not photographs; SVG can carry script.                                                                                                                                                                                                  |

Output is **WebP** (quality `IMAGE_WEBP_QUALITY`, default 80) always, and
**AVIF** (quality `IMAGE_AVIF_QUALITY`, default 60) only when
`IMAGE_AVIF_ENABLED=true`.

### Why AVIF is off by default

The production image's libvips (sharp 0.35's prebuilt binaries, which include
libheif and the AOM encoder) encodes AVIF reliably — verified inside the
Alpine container. It is off because of what it costs inside an upload request:

| Encoder setting       | Time for all five widths of a 6000 px photo | Total size of the five |
| --------------------- | ------------------------------------------- | ---------------------- |
| WebP, effort 4        | ~0.7 s                                      | 457 KB                 |
| AVIF, effort 0        | ~0.6 s                                      | 448 KB (−2%)           |
| AVIF, effort 2 (used) | ~2.5 s                                      | 432 KB (−5%)           |
| AVIF, effort 4        | ~21.8 s                                     | 397 KB (−13%)          |

A few percent smaller for several times the processing is not worth it while
processing is synchronous. Turn it on — no code change, the frontend already
offers AVIF through `<picture>` when it exists — once processing moves to a
worker or the trade-off changes.

## Generated sizes

| Name      | Width   |
| --------- | ------- |
| thumbnail | 320 px  |
| small     | 640 px  |
| medium    | 960 px  |
| large     | 1440 px |
| xlarge    | 1920 px |

(`IMAGE_VARIANT_WIDTHS`; `DEFAULT_IMAGE_VARIANT_WIDTHS` in `@vintrax/shared`.)
Nothing is upscaled and the aspect ratio is always kept. A photo narrower than
a step gets its own width as the top variant instead of that step: an 800 px
photo gets 320, 640 and **800**. A portrait photo is limited by
`IMAGE_MAX_HEIGHT`: 3000 × 4000 becomes at most 1440 × 1920.

A photo's plain `url` — what any client that does not read `optimized` shows —
is the rendition nearest `IMAGE_FALLBACK_WIDTH` (960), never the original.

## Storage structure

```text
uploads/
  vehicles/                      public, served at /uploads/vehicles/
    {asset_id}/
      320.webp
      640.webp
      960.webp
      1440.webp
      1920.webp
      (320.avif … when AVIF is on)
    {uuid}.jpg                   legacy uploads from before this pipeline
  vehicle-originals/             NOT served: originals keep their EXIF
    {asset_id}/
      original.jpg
```

Adapted from the issue's `uploads/vehicles/{vehicle_id}/{image_id}/`: a photo
is uploaded — and processed — before its listing exists (the add-vehicle form
uploads first and saves later), so there is no vehicle id to put in the path
yet. The asset id is a UUID generated by the API; no path is ever built from a
user-supplied name, and `ImageStorage` refuses any key that is not
`[a-z0-9-]+/…` or that contains `.`/`..` segments.

### The storage abstraction

```ts
interface ImageStorage {
  save(key, data, { contentType, cacheControl }): Promise<void>;
  read(key): Promise<Buffer>;
  exists(key): Promise<boolean>;
  delete(key): Promise<void>; // idempotent
  getPath(key): string; // public URL
  keyFromUrl(url): string | null;
}
```

`LocalImageStorage` is what production uses today (`STORAGE_DRIVER=local`).
`S3ImageStorage` exists only because the API already supported
`STORAGE_DRIVER=s3` and that deployment must keep working; with S3, keep the
bucket policy from exposing `vehicle-originals/`.

> The storage abstraction is intentionally designed so that
> LocalImageStorage can later be replaced by Google Cloud Storage during the
> Google Cloud migration.

A `GoogleCloudImageStorage` implementing the same six methods, selected in
`createImageStorage()`, is the whole change on the storage side;
`ImageProcessor` and `VehicleImagesService` do not change. The one piece of
data to migrate with the files is `VehicleImageAsset.baseUrl` (and
`VehicleImage.url`), which hold the public URL prefix — the same rewrite every
stored URL in the app would need.

## Database

`VehicleImageAsset` — one row per processed photo:

| Column                                                      | Meaning                                                          |
| ----------------------------------------------------------- | ---------------------------------------------------------------- |
| `id`                                                        | Asset id, also the storage folder                                |
| `status`                                                    | `PROCESSING`, `READY` or `FAILED` (with `error`)                 |
| `url`                                                       | The fallback rendition; what clients send back in `images[].url` |
| `baseUrl`, `widths`, `formats`                              | Renditions are `<baseUrl>/<width>.<format>`                      |
| `width`, `height`                                           | Largest rendition — the display aspect ratio                     |
| `originalKey`, `originalWidth/Height/SizeBytes/ContentType` | The retained original                                            |
| `legacyUrl`                                                 | For a backfilled photo, the URL it was made from (unique)        |
| `uploadedById`, `processingMs`, `processedAt`               | Who, how long, when                                              |

`VehicleImage` gains a nullable `assetId`. The asset is a separate table rather
than columns on `VehicleImage` because the two live differently: the photo
exists before its listing, and `VehicleImage` rows are replaced wholesale on
every listing save. Saving a listing with `images: [{ url }]` links each URL
that is a `READY` asset — only one this user uploaded, or one already on the
listing (administrators excepted), so a seller cannot adopt another's upload
by its URL.

## Deletion and replacement

- **Deleting** a photo (`DELETE /vehicles/:id/images/:imageId`, or saving the
  listing without it, or deleting the listing) removes the variants, the
  original and the asset row — but only once no listing references the asset
  any more, and only after the write that detached it has committed.
  Idempotent: a second delete finds nothing to do and still answers 204.
- **Replacing** a photo (`PUT /vehicles/:id/images/:imageId`) processes and
  stores the new photo under a new asset id first, then points the row at it,
  then deletes the old files. At no point does the listing reference a file
  that is not there.

## Caching

A variant URL never changes content: every upload and every replacement gets a
new asset id, so a new folder. The API therefore serves `/uploads/vehicles/`
with `Cache-Control: public, max-age=31536000, immutable`; S3 uploads carry the
same header. `infrastructure/nginx/vintrax.conf.example` passes it through for
`/uploads/vehicles/` rather than applying the shorter private policy it keeps
for other upload folders.

## Frontend

`<OptimizedImage>` is the one way a vehicle photo is drawn — cards, list rows,
comparison, the vehicle page gallery, dealer inventory, moderation and
auctions on the web app; cards, gallery, auction rows and inventory on mobile.
For a processed photo it renders:

```html
<picture>
  <source type="image/avif" srcset="… 320w, … 640w" sizes="…" />
  <!-- only if AVIF exists -->
  <img
    src="…/960.webp"
    srcset="…/320.webp 320w, …/640.webp 640w, …"
    sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
    width="1920"
    height="1280"
    loading="lazy"
    decoding="async"
    alt="…"
  />
</picture>
```

- `sizes` values live in one place, `IMAGE_SIZES`, one per layout.
- Every photo is `loading="lazy"` and `decoding="async"` except the vehicle
  page's main photo — the largest paint — which is `loading="eager"` with
  `fetchpriority="high"` (`priority` prop).
- `width`/`height` give the browser the real aspect ratio, and every layout
  also reserves its box (`aspect-[4/3]` or fixed sizes), so nothing shifts when
  a photo arrives. Measured in Chromium on the vehicle page: cumulative layout
  shift 0 at 390 px and 1440 px.
- A photo with no renditions (legacy, or a seed SVG) is drawn from its plain
  URL exactly as before; on mobile it still goes through `next/image`.

Measured in Chromium: a 390 px phone at 3× density downloads the 1440 px
rendition for the main photo; a 1440 px desktop downloads the 960 px one.
Neither ever requests the original.

## Configuration

| Variable                       | Default                 | Meaning                                             |
| ------------------------------ | ----------------------- | --------------------------------------------------- |
| `IMAGE_MAX_UPLOAD_BYTES`       | `15728640` (15 MB)      | Largest upload accepted (413 above it)              |
| `IMAGE_MAX_INPUT_DIMENSION`    | `12000`                 | Longest side accepted                               |
| `IMAGE_MAX_INPUT_PIXELS`       | `60000000`              | Decoded pixel budget — the decompression-bomb guard |
| `IMAGE_MAX_WIDTH` / `_HEIGHT`  | `1920` / `1920`         | Box the largest variant fits inside                 |
| `IMAGE_VARIANT_WIDTHS`         | `320,640,960,1440,1920` | Rendered widths                                     |
| `IMAGE_FALLBACK_WIDTH`         | `960`                   | Width behind a photo's plain `url`                  |
| `IMAGE_WEBP_QUALITY`           | `80`                    |                                                     |
| `IMAGE_AVIF_ENABLED`           | `false`                 | See "Why AVIF is off by default"                    |
| `IMAGE_AVIF_QUALITY`           | `60`                    |                                                     |
| `IMAGE_PROCESSING_CONCURRENCY` | `2`                     | Photos processed at once per API process            |

All are validated at startup in `backend/src/config/env.ts`.

## Existing-image migration

Photos uploaded before this pipeline keep working unchanged — their URLs still
resolve and the frontend draws them from `url`. To give them renditions:

```bash
# Inside the API container (production):
docker compose exec api node dist/cli/images-migrate.js --dry-run
docker compose exec api node dist/cli/images-migrate.js --limit 200
docker compose exec api node dist/cli/images-migrate.js --vehicle-id <uuid>

# Locally, after `pnpm --filter @vintrax/backend build`:
cd backend && node --env-file=.env dist/cli/images-migrate.js --dry-run
# (or `pnpm images:migrate -- --dry-run` / `npm run images:migrate -- --dry-run`
#  with the environment already set)
```

It finds every `VehicleImage` without an asset, and for each distinct URL:
processes the file through the same pipeline as an upload, then points the
rows at the result (`url` moves to the WebP rendition too). It reports
`processed`, `linked`, `would-process` (dry run), `skipped-external` (a URL not
in our storage), `skipped-missing` (file gone), `skipped-unsupported` (the seed
SVGs, or an unreadable file) and `failed`, and exits non-zero if anything
failed.

Safe to run any number of times: rows that already have an asset are skipped,
and a photo processed but not yet linked (a run stopped in between) is found by
its `legacyUrl` and linked rather than processed again. **Originals are never
deleted or modified**, so every old URL keeps working.

To measure the pipeline on real photos, inside the container:
`node dist/cli/images-benchmark.js photo1.jpg photo2.png`.

## Performance

Measured inside the production image (`node:22-alpine`, sharp 0.35.4, libvips
8.18.6, musl), 4 vCPU:

| Photo                          | Original | 320     | 640      | 960     | 1440     | 1920            | Time   |
| ------------------------------ | -------- | ------- | -------- | ------- | -------- | --------------- | ------ |
| Camera-sized JPEG, 6000 × 4899 | 5121 KB  | 12.2 KB | 40.3 KB  | 73.3 KB | 133.1 KB | 198.1 KB        | 946 ms |
| Photograph, PNG, 2725 × 2225   | 10186 KB | 12.0 KB | 40.4 KB  | 73.9 KB | 134.8 KB | 199.4 KB        | 919 ms |
| Photograph, WebP, 2725 × 2225  | 711 KB   | 12.1 KB | 39.4 KB  | 70.3 KB | 123.6 KB | 181.3 KB        | 890 ms |
| Street scene, JPEG, 810 × 1080 | 476 KB   | 36.2 KB | 127.7 KB | —       | —        | 202.4 KB at 810 | 303 ms |

For the camera-sized JPEG the 960 px rendition a desktop card or gallery
downloads is **98.6% smaller** than the original, and the 1920 px one 96.1%.
The camera-sized photo is a real 2725 px photograph enlarged to 6000 px with
sensor-style noise and saved at JPEG quality 92 (5.1 MB, like a 30 MP phone
photo) — the sandbox this was measured in cannot download photographs from
photo sites. With `IMAGE_AVIF_ENABLED=true` the same photo takes 2.3 s and its
AVIF renditions are 0–18% smaller than the WebP ones.

WebP at quality 80 is the usual point where compression artefacts stop being
visible at normal viewing size; the renditions were inspected by eye at 100%.

## Troubleshooting

| Symptom                                           | Likely cause and fix                                                                                                                                                                                                    |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Upload answers 413                                | Larger than `IMAGE_MAX_UPLOAD_BYTES`. If the 413 is an HTML page rather than JSON, the proxy refused it first: nginx `client_max_body_size` and the ingress `proxy-body-size` (both 16 MB) must stay above the setting. |
| Upload answers 400 "not a supported photo" / HEIC | The file is not JPEG/PNG/WebP/AVIF by content. Export as JPEG.                                                                                                                                                          |
| Upload answers 400 "larger than Vintrax accepts"  | Over `IMAGE_MAX_INPUT_DIMENSION` or `IMAGE_MAX_INPUT_PIXELS`.                                                                                                                                                           |
| Upload answers 500 "could not be processed"       | Look for `image <id> FAILED … variant=…` in the API log; the asset row holds the error.                                                                                                                                 |
| `Could not load the "sharp" module` at startup    | `node_modules` built for a different platform (e.g. copied from macOS). Reinstall inside the image; the lockfile carries the `linuxmusl` binaries the Alpine image needs.                                               |
| Renditions 404 while the page references them     | `/uploads/vehicles/` not routed to the API: nginx and the Kubernetes ingress route `/uploads` to the API; check a custom proxy does too.                                                                                |
| Old photos still full-size                        | They predate the pipeline — run `images:migrate`.                                                                                                                                                                       |
| API memory climbs during a big batch upload       | Lower `IMAGE_PROCESSING_CONCURRENCY` (each photo in flight needs roughly its decoded size in memory, ~11 MB at 1920 px).                                                                                                |

## Known limitations

- Processing is synchronous in the upload request. At ~1 s per camera photo
  and a concurrency cap it is bounded, but a 30-photo batch on one API process
  takes ~15 s end to end. The queue that already exists (BullMQ) is the place
  to move it; `ImageProcessor` needs no change for that.
- HEIC/HEIF is not supported (see above).
- A photo uploaded but never attached to a listing (the dealer abandons the
  form) keeps its files; the same was true before this pipeline. A periodic
  sweep of `READY` assets with no `VehicleImage` older than a day would clear
  them.
- Legacy originals under `/uploads/vehicles/<uuid>.jpg` stay public at their
  old URLs after migration, EXIF included, because the first migration never
  deletes originals.
- Inspection photos, logos, body-type photos and article images still use the
  earlier single-file upload path.
