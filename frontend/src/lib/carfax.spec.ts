import { describe, expect, it } from 'vitest';
import { HEADER_ALIASES, INVENTORY_CSV_COLUMNS, isCarfaxUrl, resolveHeader } from '@vintrax/shared';

/**
 * The CARFAX link, and the alias table.
 *
 * Both are checks that only matter when something is wrong. A link that is not
 * validated puts a trusted third party's name on a button that goes anywhere,
 * and a column alias claimed twice sends a dealer's data into the wrong field
 * with nothing on screen to say so.
 */

describe('isCarfaxUrl', () => {
  it('accepts the address a shared report lives at', () => {
    for (const url of [
      'https://vhr.carfax.ca/report/abc',
      'https://vhr.carfax.ca/?id=ABC123',
      'https://VHR.CARFAX.CA/report/abc',
    ]) {
      expect(isCarfaxUrl(url)).toBe(true);
    }
  });

  it('refuses a CARFAX address that is not a report', () => {
    // Narrowed deliberately. These are genuine CARFAX pages and none of them
    // holds a report about any particular car, so there is nothing to fetch and
    // nothing to show a buyer.
    for (const url of [
      'https://www.carfax.ca/vhr/ABC123',
      'https://carfax.ca/vehicle-history-report',
      'https://www.carfax.com/vehicle/1234',
    ]) {
      expect(isCarfaxUrl(url)).toBe(false);
    }
  });

  it('refuses a lookalike host', () => {
    // The reason this is a parsed host and not a prefix match on the string.
    // Every one of these contains "vhr.carfax.ca" somewhere.
    for (const url of [
      'https://vhr.carfax.ca.example.com/report',
      'https://evil.vhr.carfax.ca/report',
      'https://notvhr.carfax.ca/report',
      'https://evil.example.com/?next=https://vhr.carfax.ca/',
      'https://evil.example.com/vhr.carfax.ca/report',
      'https://xn--carfax-0na.ca/vhr',
    ]) {
      expect(isCarfaxUrl(url)).toBe(false);
    }
  });

  it('refuses http, because a report link is not rewritable in transit', () => {
    expect(isCarfaxUrl('http://vhr.carfax.ca/report/abc')).toBe(false);
  });

  it('refuses credentials in the URL', () => {
    // `https://vhr.carfax.ca@evil.example.com/` parses with the host on the
    // right, which is why this is checked rather than assumed away.
    expect(isCarfaxUrl('https://user:secret@vhr.carfax.ca/report')).toBe(false);
    expect(isCarfaxUrl('https://vhr.carfax.ca@evil.example.com/report')).toBe(false);
  });

  it('refuses schemes that are not a link at all', () => {
    for (const url of ['javascript:alert(1)', 'data:text/html,<h1>hi', 'file:///etc/passwd', '']) {
      expect(isCarfaxUrl(url)).toBe(false);
    }
  });

  it('refuses text that is not a URL', () => {
    expect(isCarfaxUrl('vhr.carfax.ca')).toBe(false);
    expect(isCarfaxUrl('see the carfax')).toBe(false);
  });
});

describe('the inventory CSV alias table', () => {
  it('builds without a collision', () => {
    // The table throws at module load on a duplicate, so reaching this line at
    // all is the assertion. It is kept because the failure it guards against —
    // two columns claiming one alias — is invisible in review and silent at
    // runtime: the later column simply wins.
    expect(HEADER_ALIASES.size).toBeGreaterThan(0);
  });

  it('keeps Brand on make, where a dealer feed means it', () => {
    // `title_status` wanted this alias. It does not get it.
    expect(resolveHeader('Brand')).toEqual({ kind: 'mapped', column: 'make' });
    expect(resolveHeader('Title Status')).toEqual({ kind: 'mapped', column: 'title_status' });
  });

  it('reports Style rather than guessing which column it meant', () => {
    // It means the trim about as often as it means the shape. The importer says
    // so instead of picking, the same way it refuses to guess an enum value.
    expect(resolveHeader('Style')).toEqual({ kind: 'unrecognised' });
  });

  it('maps every canonical key to itself', () => {
    for (const column of INVENTORY_CSV_COLUMNS) {
      expect(resolveHeader(column.key)).toEqual({ kind: 'mapped', column: column.key });
    }
  });
});
