import { describe, expect, it } from 'vitest';
import { formatDescription, splitSentences } from '@vintrax/shared';

/**
 * Reading a listing description that arrived as one paragraph.
 *
 * The rule that matters most is the last one here: every character of the input
 * survives. This is a view of what the dealer wrote, and a formatter that
 * quietly drops a sentence is worse than no formatter at all.
 *
 * The long fixture is a real dealer feed's description with the vehicle details
 * left as written and nothing added — it is the shape this exists for.
 */

const REAL = [
  'FREE 3000 KM COMPREHENSIVE LUBRICO WARRANTY!! 2015 Hyundai Santa Fe Sport AWD',
  '– Powerful, Comfortable & Ready for Every Season Proudly offered by Variety',
  'Auto, this 2015 Hyundai Santa Fe Sport AWD is a stylish and versatile SUV that',
  'combines strong performance, comfortable seating, practical cargo space, and',
  'confident all-wheel-drive capability. Powered by a 2.4L 4-cylinder engine',
  'producing approximately 190 horsepower, this Santa Fe Sport offers a smooth and',
  'responsive driving experience. FEATURES & OPTIONS: • 2.4L 4-Cylinder Engine •',
  'Automatic Transmission • All-Wheel Drive • Comfortable Seating for Five •',
  'AM/FM/CD Audio System • Heated Front Seats • Multiple Airbags The Santa Fe Sport',
  'offers a comfortable and spacious interior with flexible rear seating and plenty',
  'of cargo room, making it an excellent choice for commuting and everyday use.',
].join(' ');

/**
 * Every word of the text, in order, minus the punctuation that becomes
 * structure: the bullet characters that turn into list items, and the colon
 * that turns into a heading. Everything else has to survive.
 */
function words(text: string): string[] {
  return text
    .replace(/[\u2022\u25cf\u25aa\u2023\u2219\u00b7\u25e6]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.replace(/:$/, ''))
    .filter(Boolean);
}

function flatten(description: string): string[] {
  return formatDescription(description).flatMap((block) =>
    block.kind === 'list' ? block.items.flatMap(words) : words(block.text),
  );
}

describe('formatDescription', () => {
  it('finds the headline, the list and the prose in a real feed description', () => {
    const blocks = formatDescription(REAL);

    expect(blocks[0]).toEqual({
      kind: 'heading',
      text: 'FREE 3000 KM COMPREHENSIVE LUBRICO WARRANTY!!',
    });
    expect(
      blocks.some((block) => block.kind === 'heading' && block.text === 'FEATURES & OPTIONS'),
    ).toBe(true);

    const list = blocks.find((block) => block.kind === 'list');
    expect(list).toBeDefined();
    expect(list?.kind === 'list' && list.items).toContain('All-Wheel Drive');
  });

  it('does not let the last bullet swallow the sentence after it', () => {
    // "Multiple Airbags The Santa Fe Sport offers…" is one string in the feed,
    // because the break between the last bullet and the closing paragraph was
    // never written.
    const list = formatDescription(REAL).find((block) => block.kind === 'list');

    expect(list?.kind === 'list' && list.items.at(-1)).toBe('Multiple Airbags');
    expect(
      formatDescription(REAL).some(
        (block) => block.kind === 'paragraph' && block.text.startsWith('The Santa Fe Sport offers'),
      ),
    ).toBe(true);
  });

  it('keeps a feature name that merely contains a lower-case word', () => {
    // "Comfortable Seating for Five" must not be cut at "for".
    const list = formatDescription(REAL).find((block) => block.kind === 'list');

    expect(list?.kind === 'list' && list.items).toContain('Comfortable Seating for Five');
  });

  it('loses no content, only the markers that became structure', () => {
    // The property that makes this safe to apply to a dealer's own words: the
    // bullets and the heading's colon are consumed because they are now the
    // shape of the output. Every other character comes out the other side.
    expect(flatten(REAL)).toEqual(words(REAL));
  });

  it('honours blank lines a dealer typed themselves', () => {
    const blocks = formatDescription('First thought.\n\nSecond thought.');

    expect(blocks).toEqual([
      { kind: 'paragraph', text: 'First thought.' },
      { kind: 'paragraph', text: 'Second thought.' },
    ]);
  });

  it('reads a list that is already one per line', () => {
    const blocks = formatDescription('- Sunroof\n- Heated seats\n- Winter tires');

    expect(blocks).toEqual([{ kind: 'list', items: ['Sunroof', 'Heated seats', 'Winter tires'] }]);
  });

  it('does not mistake a decimal or an initial for the end of a sentence', () => {
    // "2.4L" and "J. Smith" both end in a full stop doing another job. Breaking
    // there is the failure that makes a formatter look broken.
    const text =
      'Serviced by J. Smith at 48,000 km. The 2.4L engine was inspected and the 3.5L option was not fitted.';
    const blocks = formatDescription(text);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({ kind: 'paragraph', text });
  });

  it('leaves a short description as one paragraph', () => {
    const text = 'One owner, no accidents, winter tires included.';

    expect(formatDescription(text)).toEqual([{ kind: 'paragraph', text }]);
  });

  it('does not orphan a trailing sentence under its own paragraph', () => {
    const long = `${'This vehicle has been well maintained throughout its life. '.repeat(6)}Call today.`;
    const blocks = formatDescription(long);

    expect(blocks.at(-1)?.kind).toBe('paragraph');
    expect(blocks.at(-1)).toMatchObject({ text: expect.stringContaining('Call today.') });
    expect(blocks.at(-1)).not.toMatchObject({ text: 'Call today.' });
  });

  it('returns nothing for an empty description', () => {
    expect(formatDescription('')).toEqual([]);
    expect(formatDescription('   \n  ')).toEqual([]);
  });

  it('treats a long shouted sentence as prose, not as a heading', () => {
    const text =
      'THIS VEHICLE HAS BEEN FULLY RECONDITIONED AND CERTIFIED BY OUR LICENSED TECHNICIANS!';

    expect(formatDescription(text)).toEqual([{ kind: 'paragraph', text }]);
  });
});

/**
 * What a renderer uses to put each sentence of a paragraph block on its own
 * line — the "pretty view" a long paragraph gets on screen, separate from how
 * `formatDescription` groups sentences into paragraph blocks in the first
 * place.
 */
describe('splitSentences', () => {
  it('splits a paragraph into one entry per sentence', () => {
    const text = 'One owner. No accidents. Winter tires included.';

    expect(splitSentences(text)).toEqual(['One owner.', 'No accidents.', 'Winter tires included.']);
  });

  it('does not split on a decimal or an initial', () => {
    const text =
      'Serviced by J. Smith at 48,000 km. The 2.4L engine was inspected and the 3.5L option was not fitted.';

    expect(splitSentences(text)).toEqual([
      'Serviced by J. Smith at 48,000 km.',
      'The 2.4L engine was inspected and the 3.5L option was not fitted.',
    ]);
  });

  it('returns the whole text as one entry when it holds a single sentence', () => {
    expect(splitSentences('One owner, no accidents, winter tires included.')).toEqual([
      'One owner, no accidents, winter tires included.',
    ]);
  });

  it('returns nothing for empty text', () => {
    expect(splitSentences('')).toEqual([]);
    expect(splitSentences('   ')).toEqual([]);
  });
});
