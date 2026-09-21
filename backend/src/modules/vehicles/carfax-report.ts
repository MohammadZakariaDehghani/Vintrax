import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { chromium, type Browser, type BrowserContext } from 'playwright';
import { CARFAX_REPORT_HOST, isCarfaxUrl } from '@vintrax/shared';
// A pure network-safety predicate that happens to live in the inventory
// module because the photo importer needed it first. It is not inventory
// logic; it belongs in `common/` and should move there when something else
// needs it too.
import { isPrivateAddress } from '../inventory/remote-image';

/**
 * Reading a dealer's CARFAX report with a real browser.
 *
 * ── Why a browser, when a plain HTTPS request already ran here once ────────
 *
 * The earlier version of this file sent a raw HTTPS GET, and it was removed
 * (see decision D-036) because every real report came back as a static
 * "Looks like your internet browser isn't supported" page — sent before any
 * JavaScript could have run, so the report itself was never in the response.
 * `vhr.carfax.ca` renders its report client-side: the markup a plain fetch
 * receives is an empty shell and a script tag, and there is no amount of
 * regex that reads a report out of a page that was never sent one. A headless
 * browser actually executes that script, so what gets parsed below is the
 * same DOM a person looking at the link would see.
 *
 * This has not been run against a real report in this environment — the
 * sandbox's outbound network policy blocks `vhr.carfax.ca` outright, so there
 * is no way to verify the extraction below against the live site from here.
 * It is built to fail honestly rather than to guess: `unreadable` with a
 * diagnosis is the answer whenever the page does not look like what this
 * expects, not a confident empty result. See the decision log for the record
 * of that gap.
 *
 * ── What this is, and what it is not ────────────────────────────────────────
 *
 * `vhr.carfax.ca` is where CARFAX puts a *shareable* report: the address a
 * dealer is given to hand to buyers. It is not behind the dealer's login, and
 * the dealer is already publishing it on the listing — this fetches the same
 * page a buyer clicking the badge would see, rendered the same way.
 *
 * It is still an automated read of someone else's site, which their terms of
 * use may not permit, and their markup is not a contract. Both are recorded in
 * the decision log because they are the owner's to accept, not this file's.
 *
 * ── The rule that shapes everything below ───────────────────────────────────
 *
 * A parser reading rendered HTML nobody promised will one day read something
 * else. The only safe failure is *nothing*: this returns `unreadable` rather
 * than a confident empty list or an unstated badge read as false, because
 * "the report says no" and "this could not be read" must never look the same
 * to a buyer. `ok` reports a claim only when the page positively stated it.
 *
 * Nothing here reaches a listing on its own either. A successful extraction is
 * written to the vehicle record, but the seller's `showVehicleHistory` toggle
 * — off by default — is what decides whether the timeline it produced is
 * shown to a buyer, and a failed extraction never blocks saving the vehicle.
 */

/** One line from the report's accident and damage record. */
export interface CarfaxAccidentRecord {
  /** ISO date, or null when the page gave a date this refused to guess at. */
  occurredOn: string | null;
  /** What happened, as the report words it. */
  label: string;
  /** The supporting line — a repair estimate, a location, an impact point. */
  detail: string | null;
}

/** What a successful read produced. */
export interface CarfaxExtraction {
  /** True when the report states one owner, false when it states more than
   *  one, null when neither could be read off the page. */
  oneOwner: boolean | null;
  /** True when the report carries a low-kilometres/low-mileage mark, null
   *  otherwise — there is no report statement that positively means "not low",
   *  only the absence of the mark, which is not the same claim. */
  lowKilometres: boolean | null;
  records: CarfaxAccidentRecord[];
  /** Whether the accident section itself stated the vehicle has none. */
  statedAccidentFree: boolean;
}

export type CarfaxReport =
  | { status: 'ok'; extraction: CarfaxExtraction }
  /**
   * The page rendered, but nothing on it could be confidently read as a
   * report. `diagnosis` is a short, non-secret description of what the page
   * looked like instead, so a repeat failure can be acted on rather than
   * guessed at a second time.
   */
  | { status: 'unreadable'; reason: string; diagnosis?: string }
  /** The page could not be reached or rendered at all. */
  | { status: 'unreachable'; reason: string };

const NAVIGATION_TIMEOUT_MS = 20_000;
const TOTAL_TIMEOUT_MS = 40_000;
/** Rendered pages are read as text, not downloaded; this bounds what is parsed. */
const MAX_CONTENT_CHARS = 4_000_000;
/** The most records one report may contribute, so a runaway parse cannot flood a timeline. */
export const MAX_CARFAX_RECORDS = 20;

class CarfaxFetchError extends Error {}

const reasonOf = (error: unknown) =>
  error instanceof Error ? error.message : 'the request failed';

/**
 * Resolves the report host and refuses to proceed if it resolves privately.
 *
 * The browser does its own DNS resolution when it connects, so this cannot
 * pin the socket the way the old raw fetch did — Playwright has no `lookup`
 * override. It still closes the obvious case: a poisoned or misconfigured
 * resolver answering for `vhr.carfax.ca` with an internal address, caught
 * before a browser process is ever asked to visit it. The per-request
 * routing below is what keeps the *rendered page's own* requests off
 * anything but CARFAX's own domains.
 */
async function resolvePublicly(hostname: string): Promise<void> {
  const addresses = await new Promise<LookupAddress[]>((resolve, reject) => {
    dnsLookup(hostname, { all: true }, (error, result) => {
      if (error) reject(new CarfaxFetchError(`could not resolve ${hostname}`));
      else resolve(result);
    });
  });

  if (addresses.length === 0) throw new CarfaxFetchError(`could not resolve ${hostname}`);
  for (const entry of addresses) {
    if (isPrivateAddress(entry.address)) {
      throw new CarfaxFetchError('the report host resolved to a private address');
    }
  }
}

/** Hosts a report page's own scripts may load from. Everything else is blocked. */
function isCarfaxDomain(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === 'carfax.ca' || host === 'carfax.com' || host.endsWith('.carfax.ca') || host.endsWith('.carfax.com');
}

/**
 * One shared browser process, launched on first use.
 *
 * Starting Chromium per report would make every save that changes a CARFAX
 * link pay a multi-second launch cost on top of the fetch itself. Kept alive
 * across calls instead, with a fresh, isolated context per report so no
 * cookies or storage carry from one dealer's fetch to the next. If the
 * process has crashed or closed, the next call relaunches it.
 */
let browserPromise: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (browserPromise) {
    const existing = await browserPromise.catch(() => null);
    if (existing?.isConnected()) return existing;
    browserPromise = null;
  }

  browserPromise = chromium
    .launch({
      headless: true,
      // Runs as root in CI and in this sandbox, where Chromium's own sandbox
      // cannot set up user namespaces. The outer isolation this container
      // already provides is what stands in for it here.
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    })
    .catch((error: unknown) => {
      browserPromise = null;
      throw error;
    });
  return browserPromise;
}

/** Closes the shared browser. Exported for tests and graceful shutdown. */
export async function closeCarfaxBrowser(): Promise<void> {
  const existing = await browserPromise?.catch(() => null);
  browserPromise = null;
  await existing?.close().catch(() => undefined);
}

/**
 * Fetches a report page with a real browser and reads what it renders.
 *
 * The host is validated before anything else runs, and re-checked against
 * the page's own URL after navigation settles — a client-side redirect off
 * `vhr.carfax.ca` is the one thing the request-routing below cannot catch,
 * since it never leaves the browser as a new network request.
 */
export async function fetchCarfaxReport(url: string): Promise<CarfaxReport> {
  if (!isCarfaxUrl(url)) {
    return { status: 'unreachable', reason: `not a ${CARFAX_REPORT_HOST} report link` };
  }

  try {
    await resolvePublicly(CARFAX_REPORT_HOST);
  } catch (error) {
    return { status: 'unreachable', reason: reasonOf(error) };
  }

  const deadline = Date.now() + TOTAL_TIMEOUT_MS;
  let browser: Browser;
  try {
    browser = await getBrowser();
  } catch (error) {
    return { status: 'unreachable', reason: `could not start the browser: ${reasonOf(error)}` };
  }

  let context: BrowserContext | undefined;
  try {
    context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      locale: 'en-CA',
      javaScriptEnabled: true,
      serviceWorkers: 'block',
    });
    context.setDefaultTimeout(Math.max(1, deadline - Date.now()));

    // The page's own requests are limited to CARFAX's domains. This is the
    // SSRF gate for everything the rendered page itself goes on to fetch —
    // the browser resolving and connecting on its own is exactly the case
    // the old raw-socket pinning cannot cover here, so it is enforced at the
    // request layer instead.
    await context.route('**/*', (route) => {
      let hostname: string;
      try {
        hostname = new URL(route.request().url()).hostname;
      } catch {
        void route.abort();
        return;
      }
      if (isCarfaxDomain(hostname)) void route.continue();
      else void route.abort();
    });

    const page = await context.newPage();
    page.setDefaultNavigationTimeout(Math.min(NAVIGATION_TIMEOUT_MS, Math.max(1, deadline - Date.now())));

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
    } catch (error) {
      return { status: 'unreachable', reason: `the page did not load: ${reasonOf(error)}` };
    }

    // Gives client-side rendering a chance to finish without waiting for
    // trackers or long-polling connections the route filter above already
    // blocks — those would otherwise hold the network idle forever.
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => undefined);

    const finalUrl = new URL(page.url());
    if (finalUrl.hostname.toLowerCase() !== CARFAX_REPORT_HOST) {
      return {
        status: 'unreachable',
        reason: `the report link redirected to ${finalUrl.hostname}, not ${CARFAX_REPORT_HOST}`,
      };
    }

    const html = (await page.content()).slice(0, MAX_CONTENT_CHARS);
    return parseCarfaxReport(html);
  } catch (error) {
    return { status: 'unreachable', reason: reasonOf(error) };
  } finally {
    await context?.close().catch(() => undefined);
  }
}

/* ----------------------------------------------------------------- parsing */

/**
 * The words CARFAX Canada uses for the section this cares about.
 *
 * A report's "Accident / Damage Record" is its own heading. Matching on the
 * heading rather than scanning the whole document is what keeps a service
 * record mentioning "damage" from being read as a collision.
 */
const SECTION_HEADING = /accident\s*(?:\/|,|\s+or\s+|\s+and\s+)?\s*damage|damage\s*record/i;

/**
 * Headings that end the accident section, so a lien is not read as a crash.
 *
 * The plurals are not decoration. An early version ended each alternative at a
 * word boundary, which matched the heading "Lien Search" and missed the
 * heading "Liens" — and a missed boundary does not fail, it silently swallows
 * the next section and reports its dated rows as accidents.
 */
const NEXT_SECTION =
  /^(?:liens?|money owing|stolen|services?|repairs?|odometer|registrations?|import|export|recalls?|branding|inspections?|vehicle detail|summary|glossary|disclaimer|terms)\b/i;

/**
 * Statements that the vehicle has none.
 *
 * This is the only thing that licenses an empty `ok`, so it is a list of
 * phrasings rather than a loose match on "no": "no accidents reported" is a
 * finding, and a page that merely fails to mention accidents is not.
 */
const ACCIDENT_FREE =
  /\b(?:no\s+(?:accident|damage|accidents|damages)(?:\s*(?:\/|or|and)\s*damage)?\s*(?:record|records|report|reported|found|listed)?|accident[-\s]free|0\s+accident)/i;

/** Money, as a report prints it. Kept as text — this is a quotation, not a sum. */
const AMOUNT = /\$\s?\d[\d,]*(?:\.\d{2})?/;

/**
 * "One Owner", or a stated owner count that says more than one.
 *
 * There is no report phrasing that positively means "not low kilometres" the
 * way "2 Owners" positively means "not one owner" — so only this claim gets a
 * `false`. Everything else the badge check does not find stays null.
 */
const ONE_OWNER_WORDS = /\bone\s+owner\b/i;
const OWNER_COUNT = /\b(\d+)\s+(?:registered\s+)?owners?\b/i;

/** Low mileage/kilometres, as CARFAX Canada's badge is plausibly worded. */
const LOW_KM_WORDS = /\blow\s+(?:kilomet(?:er|re)s?|km|mileage)\b/i;

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

/**
 * A date from the report, or null when it will not be guessed at.
 *
 * `03/04/2019` is the fourth of March in Canada and the third of April in
 * plenty of other places, and a report rendered for either audience looks the
 * same. Where the order cannot be established from the numbers themselves,
 * this returns null and the raw text stays in the record for the dealer to
 * read. A wrong accident date on a listing is worse than a missing one.
 */
export function parseReportDate(text: string): string | null {
  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(text);
  if (iso) return validDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const named = /\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/.exec(text);
  if (named) {
    const month = MONTHS[named[1]!.slice(0, 3).toLowerCase()];
    if (month) return validDate(Number(named[3]), month, Number(named[2]));
  }

  const dayFirst = /\b(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})\b/.exec(text);
  if (dayFirst) {
    const month = MONTHS[dayFirst[2]!.slice(0, 3).toLowerCase()];
    if (month) return validDate(Number(dayFirst[3]), month, Number(dayFirst[1]));
  }

  const numeric = /\b(\d{1,2})[/.](\d{1,2})[/.](\d{4})\b/.exec(text);
  if (numeric) {
    const a = Number(numeric[1]);
    const b = Number(numeric[2]);
    if (a > 12 && b <= 12) return validDate(Number(numeric[3]), b, a);
    if (b > 12 && a <= 12) return validDate(Number(numeric[3]), a, b);
    return null;
  }

  return null;
}

function validDate(year: number, month: number, day: number): string | null {
  if (year < 1900 || year > 2200) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1) return null;
  if (date.getUTCDate() !== day) return null;

  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Rendered HTML to lines, keeping the block boundaries that separate one
 * record from the next.
 *
 * Script and style bodies go first — the rendered page still carries its own
 * JavaScript in the DOM, and the word "accident" inside it is not a finding
 * about this car.
 */
export function htmlToLines(html: string): string[] {
  const text = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(?:p|div|tr|li|h[1-6]|section|article|td|th|dt|dd)\s*>/gi, '\n')
    .replace(/<(?:br|hr)\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&[a-z]+;/gi, ' ');

  return text
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 0);
}

/** Reads the one-owner claim off the rendered page, or null if it is not stated. */
export function extractOneOwner(lines: string[]): boolean | null {
  for (const line of lines) {
    if (ONE_OWNER_WORDS.test(line)) return true;
    const match = OWNER_COUNT.exec(line);
    if (match) {
      const count = Number(match[1]);
      if (Number.isFinite(count)) return count === 1;
    }
  }
  return null;
}

/** Reads the low-kilometres claim off the rendered page, or null if it is not stated. */
export function extractLowKilometres(lines: string[]): boolean | null {
  return lines.some((line) => LOW_KM_WORDS.test(line)) ? true : null;
}

/**
 * Reads a rendered report page.
 *
 * Exported separately from the fetch so it can be tested against fixtures,
 * which is the only way it can be tested at all in this environment — the
 * real page needs a real report behind a real link, and the sandbox this was
 * built in cannot reach `vhr.carfax.ca` to capture one.
 */
export function parseCarfaxReport(html: string): CarfaxReport {
  const lines = htmlToLines(html);
  if (lines.length === 0) {
    return {
      status: 'unreadable',
      reason: 'the rendered page had no readable text',
      diagnosis: describePage(html, lines),
    };
  }

  const oneOwner = extractOneOwner(lines);
  const lowKilometres = extractLowKilometres(lines);

  const start = lines.findIndex((line) => SECTION_HEADING.test(line) && line.length < 120);
  if (start === -1) {
    // No accident section is still a usable result if either badge was
    // read: a report can be extracted for what it gave, and a missing
    // accident heading on an otherwise-real page is worth recording rather
    // than treated as a total failure.
    if (oneOwner !== null || lowKilometres !== null) {
      return {
        status: 'ok',
        extraction: { oneOwner, lowKilometres, records: [], statedAccidentFree: false },
      };
    }
    return {
      status: 'unreadable',
      reason: looksLikeAppShell(html, lines)
        ? 'this page still looks browser-rendered after loading — nothing on it could be read'
        : 'no accident or damage section was found on the page',
      diagnosis: describePage(html, lines),
    };
  }

  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (NEXT_SECTION.test(lines[index]!)) {
      end = index;
      break;
    }
  }

  const section = lines.slice(start, end);
  const records = collectRecords(section);

  if (records.length > 0) {
    return {
      status: 'ok',
      extraction: {
        oneOwner,
        lowKilometres,
        records: records.slice(0, MAX_CARFAX_RECORDS),
        statedAccidentFree: false,
      },
    };
  }

  if (section.some((line) => ACCIDENT_FREE.test(line))) {
    return {
      status: 'ok',
      extraction: { oneOwner, lowKilometres, records: [], statedAccidentFree: true },
    };
  }

  if (oneOwner !== null || lowKilometres !== null) {
    return {
      status: 'ok',
      extraction: { oneOwner, lowKilometres, records: [], statedAccidentFree: false },
    };
  }

  return {
    status: 'unreadable',
    reason: 'the accident section was found but neither records nor a clear result could be read',
    diagnosis: describePage(html, section),
  };
}

/**
 * Turns the section's lines into records.
 *
 * A record is anchored on a date. Everything between one date and the next
 * belongs to it, which is how a two-line entry — the date on one line, the
 * estimate on the next — survives being split into lines.
 *
 * A line carrying a repair estimate but no date still counts, because a report
 * that lists damage without dating it has still reported damage. What never
 * counts is a line with neither: that is prose, and prose is how a parser
 * invents an accident out of a disclaimer.
 */
function collectRecords(section: string[]): CarfaxAccidentRecord[] {
  const records: CarfaxAccidentRecord[] = [];
  let current: { date: string | null; parts: string[] } | null = null;

  const flush = () => {
    if (!current) return;
    const joined = current.parts.join(' — ').replace(/\s+/g, ' ').trim();
    if (joined.length === 0 && !current.date) return;

    const [label, ...rest] = splitLabel(joined);
    records.push({
      occurredOn: current.date,
      label: label || 'Accident or damage reported',
      detail: rest.join(' — ') || null,
    });
    current = null;
  };

  for (const line of section) {
    if (SECTION_HEADING.test(line) && line.length < 120) continue;
    if (ACCIDENT_FREE.test(line)) continue;

    const date = parseReportDate(line);
    const hasAmount = AMOUNT.test(line);

    if (date) {
      flush();
      current = { date, parts: [stripped(line)] };
      continue;
    }

    if (current) {
      current.parts.push(stripped(line));
      continue;
    }

    if (hasAmount) {
      current = { date: null, parts: [stripped(line)] };
    }
  }

  flush();
  return records.filter(
    (record) => record.occurredOn !== null || AMOUNT.test(record.label + (record.detail ?? '')),
  );
}

const stripped = (line: string) => line.replace(/^[\s:•\-–—|]+/, '').trim();

/**
 * Splits a joined record into a short label and the rest.
 *
 * The label is what shows on the timeline; the detail is the line under it.
 * A record is usually "date — what happened — estimate", so the first piece
 * that is not the date is the label.
 */
function splitLabel(joined: string): string[] {
  const parts = joined
    .split(' — ')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (parts.length === 0) return [''];

  const first = parts[0]!;
  const withoutDate = first
    .replace(/\b\d{4}-\d{2}-\d{2}\b/, '')
    .replace(/\b[A-Za-z]{3,9}\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}\b/, '')
    .replace(/\b\d{1,2}\s+[A-Za-z]{3,9}\.?,?\s+\d{4}\b/, '')
    .replace(/\b\d{1,2}[/.]\d{1,2}[/.]\d{4}\b/, '')
    .replace(/^[\s:•\-–—|]+/, '')
    .trim();

  const head = withoutDate.length > 0 ? withoutDate : (parts[1] ?? 'Accident or damage reported');
  const tail = withoutDate.length > 0 ? parts.slice(1) : parts.slice(2);

  return [truncate(head, 80), ...tail.map((part) => truncate(part, 160))];
}

const truncate = (value: string, max: number) =>
  value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;

/* ------------------------------------------------------------ diagnostics */

/**
 * Whether the page is still a container waiting for JavaScript to fill it,
 * even after `page.content()` was read back post-render.
 *
 * That should not happen once a real browser has run the scripts — if it
 * does, the report either failed to load past this point, or the page uses a
 * rendering approach this has not seen (a nested frame, a shadow root that
 * `page.content()` does not serialise the same way, and so on). Judged on the
 * shape rather than on any one framework: a shell is mostly script and
 * carries almost no prose.
 */
function looksLikeAppShell(html: string, lines: string[]): boolean {
  const words = lines.join(' ').split(/\s+/).filter(Boolean).length;
  const scriptBytes = [...html.matchAll(/<script\b[\s\S]*?<\/script>/gi)].reduce(
    (total, match) => total + match[0].length,
    0,
  );

  return (
    words < 120 && (scriptBytes > html.length / 3 || /<div id=["'](?:root|app|__next)/i.test(html))
  );
}

/**
 * A short, non-secret description of what the page looked like.
 *
 * Every part of this is already public — it is a page the dealer publishes to
 * buyers — and it is bounded so a failure cannot dump a report into a log or a
 * response. It exists so a failure can be acted on rather than guessed at.
 */
export function describePage(html: string, lines: string[]): string {
  const title = /<title[^>]*>([\s\S]{0,120}?)<\/title>/i.exec(html)?.[1]?.trim() ?? '(no title)';
  const words = lines.join(' ').split(/\s+/).filter(Boolean).length;

  const headings = [...html.matchAll(/<h[1-4][^>]*>([\s\S]{0,80}?)<\/h[1-4]>/gi)]
    .map((match) =>
      match[1]!
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter((heading) => heading.length > 0)
    .slice(0, 8);

  const parts = [
    `title: ${truncate(title, 80)}`,
    `${Math.round(html.length / 1024)}KB`,
    `${words} words of text`,
    looksLikeAppShell(html, lines) ? 'still looks browser-rendered' : 'looks server-rendered',
  ];
  if (headings.length > 0) parts.push(`headings: ${headings.join(' | ')}`);

  return truncate(parts.join('; '), 400);
}
