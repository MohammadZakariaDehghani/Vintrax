# Vintrax Mobile

An installable, mobile-first client of the Vintrax platform. It adds no backend,
no database and no second authentication system — every screen calls the same
API the web application calls.

## Why a second application rather than a responsive web app

The web application is already responsive and works on a phone. This exists
because "works on a phone" and "designed for a thumb" are different things: a
bidder standing on a lot needs the current price, a countdown and a bid button
without pinching, and a dealer photographing a trade-in needs the camera two
taps from the home screen. Recorded as [D-019](./decision-log.md).

What is emphatically _not_ duplicated is behaviour. Session handling, token
refresh, error mapping, the auction socket protocol and money formatting all
come from `@vintrax/client`, which both applications import.

```
packages/client/     API client · session store · auction socket · formatting
   ├── frontend/     Desktop-first marketplace
   └── mobile/       This application
```

## Screens

Five destinations in the tab bar, everything else one tap from them.

| Route                              | What it does                                                   |
| ---------------------------------- | -------------------------------------------------------------- |
| `/`                                | Search, quick actions, live auctions, recent inventory         |
| `/browse`                          | Inventory search, filter sheet, infinite scroll                |
| `/vehicles/[slug]`                 | Gallery, specifications, inspection report, message the seller |
| `/auctions`                        | Live, upcoming and ended auctions                              |
| `/auctions/[id]`                   | Live bidding room                                              |
| `/saved`                           | Favourited vehicles                                            |
| `/messages`, `/messages/[id]`      | Buyer–seller conversations                                     |
| `/account`                         | Profile, email verification, dark mode, sign out               |
| `/account/bids`                    | Bid standings                                                  |
| `/dealer/inventory`                | Own listings and dealership analytics                          |
| `/dealer/inventory/new`            | Add a vehicle, photographed with the camera                    |
| `/offline`                         | Served by the service worker when a navigation fails           |

## Design constraints

These are rules, not preferences, and the browser test suite checks the first
two:

- **44px minimum on anything tappable.** `min-h-touch` exists for this.
- **No horizontal overflow at 390px.**
- **16px base font**, because iOS zooms the page when a focused input is
  smaller.
- **Safe-area padding** on the tab bar, sheets and headers, so nothing sits
  under the home indicator or the notch.
- **Pinch-zoom stays enabled.** Disabling it fails WCAG 1.4.4, and a used-car
  photo is exactly what someone will want to magnify.

## Live bidding

The auction room subscribes to the shared WebSocket for price changes, and
falls back to a twenty-second poll whenever that connection drops — nobody
should bid against a stale price because a socket died quietly.

The bid itself goes over HTTP, never the socket, so it passes through the same
validation, rate limiting and serializable transaction as every other write.
That is why a **409 is a first-class outcome** here rather than an error to
hide: it means another bid committed first, and the room says so and shows the
new price.

## Camera

`getUserMedia` with a framing guide, and a `capture`-annotated file input
beside it at all times. The fallback is not decoration — the stream path is
unavailable in iOS in-app browsers, on insecure origins, and whenever the
permission is declined, and the component handles each case with its own
message rather than a dead viewfinder.

Photos upload one at a time as they are taken, through the platform's existing
`POST /uploads/images`. The API owns type and size validation and decides where
the bytes land, so the behaviour is identical on local disk and S3.

## Offline

Stated, never faked.

The service worker caches the application shell and **refuses to cache `/api`
at all** — inventory, bids and prices are exactly the data where a stale answer
is worse than none. Navigations are network-first with `/offline` as the
fallback. Bidding and listing controls disable themselves while the device is
offline rather than accepting input that cannot be sent.

There is no offline write queue. A bid replayed silently three minutes later is
worse than a failure the user saw.

## Configuration

No host, port or domain appears in the source. Two variables, read from the
environment:

| Variable              | Purpose                                                                |
| --------------------- | ---------------------------------------------------------------------- |
| `NEXT_PUBLIC_API_URL` | REST base. Defaults to `/api`, proxied to the API by `next.config.mjs` |
| `NEXT_PUBLIC_WS_URL`  | WebSocket origin — the proxy cannot carry an upgrade handshake         |
| `API_ORIGIN`          | Where the rewrite proxy forwards, server-side only                     |
| `MOBILE_PORT`         | Listening port, default 3002                                           |

`NEXT_PUBLIC_*` values are compiled into the bundle, so changing one is a
rebuild rather than a restart. `scripts/setup-ubuntu.sh` writes
`mobile/.env.local` alongside `frontend/.env.local`.

**The mobile origin must be in the API's `CORS_ORIGINS`.** Without it the API
refuses the WebSocket handshake and live bidding silently degrades to the
twenty-second poll — the room still works, but a price can be twenty seconds
stale. The setup script adds the mobile origins to an existing `.env`, which is
its one deliberate exception to leaving that file alone: an added origin cannot
break anything that already worked, unlike a rotated secret.

## Running it

```bash
pnpm dev:mobile      # API on :3001, mobile on :3002
pnpm dev:all         # API, web and mobile together
```

In production it is a third service on its own port — `vintrax-mobile` in
`docker-compose.yml`, a systemd unit from the setup script, or
`infrastructure/kubernetes/mobile-deployment.yaml` behind its own host.

See [deployment.md](./deployment.md) for the deployment detail.

## Testing

29 unit tests cover the logic that is easy to get subtly wrong: the error
mapping that decides whether "try again" is offered, the quick-bid ladder,
query-string construction, and the paging helper that exists because of a real
defect — appending a second `page` parameter made the API read it as an array
and return an empty list.

The application was also exercised in a real iPhone-sized browser against the
running platform: search, filtering, vehicle detail, sign-in with a seeded
account, live bidding, the 44px touch-target audit, dark mode, and the
installability of the manifest.
