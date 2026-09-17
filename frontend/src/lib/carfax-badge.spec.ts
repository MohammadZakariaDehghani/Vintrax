import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { carfaxHighlightsFor } from '@vintrax/shared';

/**
 * The CARFAX badge and the accident record it sits beside.
 *
 * Two rules here are worth more than the rest, and both are about a claim with
 * nothing behind it: a highlight drawn without a report link, and an empty
 * timeline rendered as "no accidents". Each would put an assurance in front of
 * a buyer that nobody actually made.
 */

const REPORT = 'https://vhr.carfax.ca/report/abc';

describe('carfaxHighlightsFor', () => {
  it('draws nothing at all without a report', () => {
    expect(carfaxHighlightsFor({})).toEqual([]);
    expect(carfaxHighlightsFor({ carfaxUrl: null })).toEqual([]);
  });

  it('draws the mark alone when the report is all there is', () => {
    expect(carfaxHighlightsFor({ carfaxUrl: REPORT })).toEqual([]);
  });

  it('adds a segment for each claim the report supports', () => {
    expect(carfaxHighlightsFor({ carfaxUrl: REPORT, carfaxOneOwner: true })).toEqual(['ONE_OWNER']);
    expect(carfaxHighlightsFor({ carfaxUrl: REPORT, carfaxLowKilometres: true })).toEqual([
      'LOW_KILOMETRES',
    ]);
  });

  it('keeps a fixed order, so two identical cars draw an identical badge', () => {
    // Ordering by whatever the seller ticked first would make the same pair of
    // claims render two different ways.
    const both = { carfaxUrl: REPORT, carfaxOneOwner: true, carfaxLowKilometres: true };

    expect(carfaxHighlightsFor(both)).toEqual(['ONE_OWNER', 'LOW_KILOMETRES']);
  });

  it('refuses a highlight that has no report behind it', () => {
    // The rule the API enforces, enforced again at the point of drawing in case
    // a row predates that check. A One Owner mark that opens nothing is the
    // brand's authority with the evidence removed.
    expect(carfaxHighlightsFor({ carfaxOneOwner: true, carfaxLowKilometres: true })).toEqual([]);
    expect(carfaxHighlightsFor({ carfaxUrl: '', carfaxOneOwner: true })).toEqual([]);
  });

  it('treats "not stated" and "the report says no" alike on screen', () => {
    // They differ in the database, and in the seller's own form. Neither draws
    // a segment: the badge only ever states a positive claim.
    expect(carfaxHighlightsFor({ carfaxUrl: REPORT, carfaxOneOwner: null })).toEqual([]);
    expect(carfaxHighlightsFor({ carfaxUrl: REPORT, carfaxOneOwner: false })).toEqual([]);
  });
});

/**
 * The badge is one mark, not a row of them.
 *
 * This is the thing the request was actually about — "if a car have 2 or 3 of
 * this option contact this logo together and show in one logo together, don't
 * separate them" — and it is a property of the markup rather than of any value,
 * so it is checked by reading the source. A refactor that gave each segment its
 * own rounded border or its own link would pass a typecheck and quietly undo
 * the whole feature.
 */
describe('the badge markup', () => {
  const source = readFileSync('src/components/carfax-badge.tsx', 'utf8');

  it('reads the real component', () => {
    expect(source).toContain('export function CarfaxBadge');
  });

  it('is a single link, whatever the car has on it', () => {
    // Three anchors would be three destinations for one report.
    expect(source.match(/<a\b/g)).toHaveLength(1);
  });

  it('rounds and clips the strip as a whole, never the segments', () => {
    // `overflow-hidden` on the container is what lets the segments be plain
    // rectangles that share one outline. Rounding a segment would put a visible
    // notch between it and the next.
    expect(source).toMatch(/inline-flex[^'"]*overflow-hidden[^'"]*rounded/);

    const segmentRounding = source.match(/HIGHLIGHT_BACKGROUND\[[^\]]+\][^)]*rounded/);
    expect(segmentRounding).toBeNull();
  });

  it('keeps no gap between the segments', () => {
    // A `gap` on the container is the other way to accidentally separate them.
    expect(source).not.toMatch(/inline-flex[^'"]*\bgap-/);
  });

  it('stays a server component with no event handler', () => {
    // Issue #37: a handler here breaks every server-rendered listing outright.
    expect(source).not.toMatch(/^['"]use client['"]/m);
    expect(source).not.toMatch(/\bon[A-Z]\w+=\{/);
  });

  it('says what it is to a screen reader, without claiming Vintrax checked it', () => {
    expect(source).toContain('aria-label');
    expect(source).toContain('seller reports');
    expect(source).not.toMatch(/\bverified\b/i);
  });
});
