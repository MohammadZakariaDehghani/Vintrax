import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { request as httpsRequest, type RequestOptions } from 'node:https';
import { CARFAX_REPORT_HOST, isCarfaxUrl } from '@vintrax/shared';
// A pure network-safety predicate that happens to live in the inventory
// module because the photo importer needed it first. It is not inventory
// logic; it belongs in `common/` and should move there when something else
// needs it too.
import { isPrivateAddress } from '../inventory/remote-image';

/**
 * Reading a dealer's CARFAX report.
 *
 * ── What this is, and what it is not ────────────────────────────────────────
 *
 * `vhr.carfax.ca` is where CARFAX puts a *shareable* report: the address a
 * dealer is given to hand to buyers. It is not behind the dealer's login, and
 * the dealer is already publishing it on the listing. That is what makes
 * reading it different from reaching into a paid account — the page is one
 * they chose to make public, and this fetches the same bytes a buyer clicking
 * the badge would receive.
 *
 * It is still an automated read of someone else's site, which their terms of
 * use may not permit, and their markup is not a contract. Both are recorded in
 * the decision log because they are the owner's to accept, not this file's.
 *
 * ── The rule that shapes everything below ───────────────────────────────────
 *
 * A parser reading HTML nobody promised will one day read something else. The
 * only safe failure is *nothing*: this returns `unreadable` rather than a
 * confident empty list, because "no accidents found" and "I could not find the
 * accident section" look identical to a caller and mean opposite things to a
 * buyer. `ok` with zero records is returned only when the page positively
 * states the vehicle has none.
 *
 * Nothing here reaches a listing on its own either. What it returns is shown
 * to the dealer, who has the report open, and published only if they say it is
 * right. That review is the real safety net; this is a first draft for a human
 * to check.
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

export type CarfaxReport =
  /**
   * The accident section was found and understood. `records` may be empty, but
   * only when the page said so — see `statedAccidentFree`.
   */
  | { status: 'ok'; records: CarfaxAccidentRecord[]; statedAccidentFree: boolean }
  /**
   * The page was fetched, but its accident section could not be located.
   *
   * `diagnosis` is a short, non-secret description of what the page looked
   * like instead — the title, how much text it carried, whether it appears to
   * be a JavaScript shell. It exists because the first real report failed here
   * and there was nothing in the failure to act on: "not found" is the same
   * message whether the page changed shape, was never a report, or renders
   * entirely in the browser. This turns a second guess into a fix.
   */
  | { status: 'unreadable'; reason: string; diagnosis?: string }
  /** The page could not be fetched at all. */
  | { status: 'unreachable'; reason: string };

/** Report pages are documents, not downloads. Anything larger is not one. */
const MAX_BYTES = 4 * 1024 * 1024;
const CONNECT_TIMEOUT_MS = 10_000;
const TOTAL_TIMEOUT_MS = 25_000;

/** The most records one report may contribute, so a runaway parse cannot flood a timeline. */
export const MAX_CARFAX_RECORDS = 20;

/* ------------------------------------------------------------------ fetch */

/**
 * Fetches a report page and reads its accident record.
 *
 * Redirects are not followed. The host is pinned to one name, so a redirect is
 * either within that host — in which case the first URL was not the report
 * link the dealer was given — or off it, which is the thing the pin exists to
 * prevent. Refusing is both safer and more honest than quietly reading a
 * different page than the one on the listing.
 */
export async function fetchCarfaxReport(url: string): Promise<CarfaxReport> {
  if (!isCarfaxUrl(url)) {
    return { status: 'unreachable', reason: `not a ${CARFAX_REPORT_HOST} report link` };
  }

  let addresses: LookupAddress[];
  try {
    addresses = await resolvePublicly(CARFAX_REPORT_HOST);
  } catch (error) {
    return { status: 'unreachable', reason: reasonOf(error) };
  }

  let html: string;
  try {
    html = await getOnce(new URL(url), addresses);
  } catch (error) {
    return { status: 'unreachable', reason: reasonOf(error) };
  }

  return parseCarfaxReport(html);
}

class CarfaxFetchError extends Error {}

const reasonOf = (error: unknown) =>
  error instanceof Error ? error.message : 'the request failed';

/**
 * Resolves the one host and refuses any address that is not publicly routable.
 *
 * The host is fixed, so this is a narrow check by construction — but a
 * resolver that can be influenced is exactly how a fixed hostname becomes a
 * request to `169.254.169.254`. Every address is checked, not only the first,
 * because a name answering with both a public and a private address would
 * otherwise be usable by retrying.
 */
async function resolvePublicly(hostname: string): Promise<LookupAddress[]> {
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
  return addresses;
}

/**
 * One GET, to an address that already passed the check.
 *
 * `lookup` is overridden so the connection uses the vetted address rather than
 * resolving the name a second time. That second resolution is the DNS
 * rebinding window; this is what closes it.
 */
function getOnce(url: URL, addresses: LookupAddress[]): Promise<string> {
  const deadline = Date.now() + TOTAL_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    const options: RequestOptions = {
      method: 'GET',
      hostname: url.hostname,
      port: url.port || 443,
      path: `${url.pathname}${url.search}`,
      headers: {
        // Named honestly, so CARFAX can see who is reading and block it if they
        // would rather we did not.
        'user-agent': 'Vintrax-CarfaxReader/1 (+https://vintrax.ca)',
        accept: 'text/html,application/xhtml+xml',
        // The body is buffered, so a compressed stream could expand past the
        // cap after it was checked.
        'accept-encoding': 'identity',
      },
      lookup: (_hostname, lookupOptions, callback) => {
        const first = addresses[0];
        if (!first) {
          (callback as (error: Error | null) => void)(new CarfaxFetchError('no address'));
          return;
        }
        if (typeof lookupOptions === 'object' && lookupOptions !== null && lookupOptions.all) {
          (callback as (error: Error | null, found: LookupAddress[]) => void)(null, addresses);
          return;
        }
        (callback as (error: Error | null, address: string, family: number) => void)(
          null,
          first.address,
          first.family,
        );
      },
    };

    const request = httpsRequest(options, (message) => {
      const status = message.statusCode ?? 0;

      if (status >= 300 && status < 400) {
        message.destroy();
        reject(
          new CarfaxFetchError(
            `the report link redirects (HTTP ${status}). Copy the share link from CARFAX again.`,
          ),
        );
        return;
      }
      if (status !== 200) {
        message.destroy();
        reject(
          new CarfaxFetchError(
            status === 404 || status === 410
              ? 'CARFAX says that report no longer exists. Report links expire.'
              : `CARFAX answered HTTP ${status}`,
          ),
        );
        return;
      }

      const chunks: Buffer[] = [];
      let size = 0;

      message.on('data', (chunk: Buffer) => {
        size += chunk.byteLength;
        if (size > MAX_BYTES) {
          message.destroy();
          reject(new CarfaxFetchError('the report page is larger than expected'));
          return;
        }
        chunks.push(chunk);
      });
      message.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      message.on('error', (error) => reject(new CarfaxFetchError(error.message)));
    });

    request.setTimeout(Math.min(CONNECT_TIMEOUT_MS, Math.max(1, deadline - Date.now())), () => {
      request.destroy(new CarfaxFetchError('CARFAX did not answer in time'));
    });
    request.on('error', (error) =>
      reject(error instanceof CarfaxFetchError ? error : new CarfaxFetchError(error.message)),
    );
    request.end();
  });
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

  // "March 14, 2019" and "Mar 2019" — a month name removes the ambiguity.
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

  // A month with no day is still a usable date; the first of the month is a
  // guess, so it is refused and only the year-month is not enough to store.
  const numeric = /\b(\d{1,2})[/.](\d{1,2})[/.](\d{4})\b/.exec(text);
  if (numeric) {
    const a = Number(numeric[1]);
    const b = Number(numeric[2]);
    // Only when one of the two cannot be a month is the order knowable.
    if (a > 12 && b <= 12) return validDate(Number(numeric[3]), b, a);
    if (b > 12 && a <= 12) return validDate(Number(numeric[3]), a, b);
    return null;
  }

  return null;
}

function validDate(year: number, month: number, day: number): string | null {
  if (year < 1900 || year > 2200) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  // Rejects the 31st of February rather than letting Date roll it forward.
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1) return null;
  if (date.getUTCDate() !== day) return null;

  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * HTML to lines, keeping the block boundaries that separate one record from
 * the next.
 *
 * Script and style bodies go first — a report page carries its own JavaScript,
 * and the word "accident" inside it is not a finding about this car.
 */
export function htmlToLines(html: string): string[] {
  const text = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    // Anything that ends a visual block becomes a line break, so a table row
    // does not run into the next one.
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

/**
 * Reads a report page.
 *
 * Exported separately from the fetch so it can be tested against fixtures,
 * which is the only way it can be tested at all — the real page needs a real
 * report behind a real link.
 */
export function parseCarfaxReport(html: string): CarfaxReport {
  // The report's own data first, its rendered text second.
  //
  // The first real report failed here with "no accident or damage section was
  // found", having fetched cleanly — which is what a page whose content is
  // drawn by JavaScript looks like from a server. There is no accident heading
  // in the HTML because there is no report in the HTML: there is an empty
  // container and a blob of JSON the browser turns into one. So the JSON is
  // looked at before the text, and when neither yields anything the failure
  // says which of the two cases it was.
  const fromData = parseEmbeddedData(html);
  if (fromData) return fromData;

  const lines = htmlToLines(html);
  if (lines.length === 0) {
    return {
      status: 'unreadable',
      reason: 'the page had no readable text',
      diagnosis: describePage(html, lines),
    };
  }

  const start = lines.findIndex((line) => SECTION_HEADING.test(line) && line.length < 120);
  if (start === -1) {
    return {
      status: 'unreadable',
      reason: looksLikeAppShell(html, lines)
        ? 'this report is drawn in the browser, so the page itself carries no accident section'
        : 'no accident or damage section was found on the page',
      diagnosis: describePage(html, lines),
    };
  }

  // The section runs to the next known heading, or to the end.
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
      records: records.slice(0, MAX_CARFAX_RECORDS),
      statedAccidentFree: false,
    };
  }

  // Empty is a finding only where the page says so.
  if (section.some((line) => ACCIDENT_FREE.test(line))) {
    return { status: 'ok', records: [], statedAccidentFree: true };
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
    // The heading itself, and the accident-free statement, are not records.
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

    // No open record and no date: only an amount makes this a record on its own.
    if (hasAmount) {
      current = { date: null, parts: [stripped(line)] };
    }
  }

  flush();
  return records.filter(
    (record) => record.occurredOn !== null || AMOUNT.test(record.label + (record.detail ?? '')),
  );
}

/** Drops leading punctuation and label noise a report puts before the value. */
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

  // The first part often still carries the date it was found by; the words
  // after it are the useful label.
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

/* ------------------------------------------------- the report's own data */

/**
 * Keys a report's data is plausibly keyed by.
 *
 * Deliberately a list of names rather than a search for anything containing
 * "accident": the page's own JavaScript mentions the word, and a match on a
 * feature flag called `showAccidentBanner` would be read as a finding.
 */
const ACCIDENT_KEYS = /^(?:accidents?|damages?|accidentdamage|accidentrecords?|damagerecords?)$/i;
const DATE_KEYS = /^(?:date|accidentdate|damagedate|occurredon|occurred|eventdate|reportedon)$/i;
const AMOUNT_KEYS = /^(?:amount|estimate|damageamount|estimatedcost|cost|repaircost|total)$/i;
const LABEL_KEYS = /^(?:description|label|type|title|detail|details|summary|event|text)$/i;
const FREE_KEYS = /^(?:accidentfree|noaccidents|hasaccidents?|accidentsreported|damagereported)$/i;

/** Anything that is not a letter or digit, for comparing key names loosely. */
const bare = (key: string) => key.replace(/[^a-z0-9]/gi, '').toLowerCase();

/**
 * Reads the JSON a page hands its own JavaScript.
 *
 * Three shapes are looked at, which between them cover how a modern page
 * carries its data: a `<script type="application/json">` block (Next.js writes
 * `__NEXT_DATA__` this way), and an assignment to a window global.
 *
 * Returns null rather than an `unreadable` result, because failing to find
 * data is not itself a finding — the caller falls through to reading the
 * rendered text, which is still how a server-rendered report would be read.
 */
function parseEmbeddedData(html: string): CarfaxReport | null {
  for (const blob of embeddedJson(html)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(blob);
    } catch {
      continue;
    }

    const found = walkForAccidents(parsed);
    if (found) return found;
  }
  return null;
}

/** Every JSON blob the page carries, largest first — the data is rarely the small one. */
function embeddedJson(html: string): string[] {
  const blobs: string[] = [];

  const script =
    /<script\b[^>]*type=["']application\/(?:ld\+)?json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(script)) {
    if (match[1]) blobs.push(match[1].trim());
  }

  // `window.__DATA__ = {...};` and friends. Non-greedy to the line's end, then
  // trimmed of a trailing semicolon; a blob that does not parse is skipped.
  const assignment =
    /(?:window|self|globalThis)\.__[A-Z0-9_]+__\s*=\s*(\{[\s\S]*?\})\s*;?\s*(?:<\/script>|\n)/gi;
  for (const match of html.matchAll(assignment)) {
    if (match[1]) blobs.push(match[1]);
  }

  return blobs.sort((a, b) => b.length - a.length).slice(0, 8);
}

/**
 * Walks parsed JSON looking for something shaped like an accident record.
 *
 * Bounded in both depth and breadth: a page's data blob can be enormous, and
 * an unbounded walk over attacker-influenced JSON is a way to spend a request's
 * entire budget on recursion.
 */
function walkForAccidents(root: unknown): CarfaxReport | null {
  const queue: Array<{ value: unknown; depth: number }> = [{ value: root, depth: 0 }];
  let seen = 0;
  let statedFree = false;

  while (queue.length > 0 && seen < 20_000) {
    const next = queue.shift();
    if (!next) break;
    const { value, depth } = next;
    seen += 1;

    if (depth > 12 || value === null || typeof value !== 'object') continue;

    if (Array.isArray(value)) {
      for (const entry of value) queue.push({ value: entry, depth: depth + 1 });
      continue;
    }

    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const name = bare(key);

      if (FREE_KEYS.test(name)) {
        // `accidentFree: true` and `hasAccidents: false` say the same thing.
        if (/^(?:accidentfree|noaccidents)$/i.test(name) && child === true) statedFree = true;
        if (/^(?:hasaccidents?|accidentsreported|damagereported)$/i.test(name) && child === false) {
          statedFree = true;
        }
      }

      if (ACCIDENT_KEYS.test(name) && Array.isArray(child)) {
        const records = child
          .map((entry) => recordFrom(entry))
          .filter((record): record is CarfaxAccidentRecord => record !== null);

        if (records.length > 0) {
          return {
            status: 'ok',
            records: records.slice(0, MAX_CARFAX_RECORDS),
            statedAccidentFree: false,
          };
        }
      }

      queue.push({ value: child, depth: depth + 1 });
    }
  }

  // An empty list plus an explicit "none" is a finding; an empty list alone is
  // not, and falls through to the text reader rather than being called clean.
  return statedFree ? { status: 'ok', records: [], statedAccidentFree: true } : null;
}

/** One entry of an accident array, if it looks like one. */
function recordFrom(entry: unknown): CarfaxAccidentRecord | null {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return null;

  let occurredOn: string | null = null;
  let label = '';
  let amount = '';

  for (const [key, value] of Object.entries(entry as Record<string, unknown>)) {
    if (typeof value !== 'string' && typeof value !== 'number') continue;
    const text = String(value).trim();
    if (text.length === 0) continue;
    const name = bare(key);

    if (!occurredOn && DATE_KEYS.test(name)) occurredOn = parseReportDate(text);
    else if (!label && LABEL_KEYS.test(name)) label = truncate(text, 80);
    else if (!amount && AMOUNT_KEYS.test(name)) amount = text;
  }

  // Neither a date nor a label means this was not a record, whatever the key
  // it sat under was called.
  if (!occurredOn && label.length === 0) return null;

  return {
    occurredOn,
    label: label || 'Accident or damage reported',
    detail: amount ? truncate(/^\$/.test(amount) ? amount : `$${amount}`, 160) : null,
  };
}

/* ------------------------------------------------------------ diagnostics */

/**
 * Whether the page is a container waiting for JavaScript to fill it.
 *
 * Judged on the shape rather than on any one framework: a shell is mostly
 * script and carries almost no prose. The threshold is deliberately loose —
 * being wrong here changes only the wording of a failure, never whether
 * something is reported as a finding.
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

  // The page's own headings, which say what it actually contains.
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
    `${embeddedJson(html).length} JSON blocks`,
    looksLikeAppShell(html, lines) ? 'looks browser-rendered' : 'looks server-rendered',
  ];
  if (headings.length > 0) parts.push(`headings: ${headings.join(' | ')}`);

  return truncate(parts.join('; '), 400);
}
