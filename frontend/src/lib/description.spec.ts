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
    .replace(/[\u2022\u25cf\u25aa\u2023\u2219\u00b7\u25e6\u2714\u2713]/g, ' ')
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
 * Issue #55: Seller Notes written as one dense block, with sections and lists
 * that survived only as a checkmark, a colon, or a capitalised word butted up
 * against the sentence after it — never as an ALL-CAPS shout, which is all
 * the formatter recognised before.
 */
describe('formatDescription — Seller Notes sections', () => {
  it('reads a hand-typed checkmark list as a bullet list', () => {
    const text = [
      '✔ Rare John Cooper Works Performance Model',
      '✔ Desirable 6-Speed Manual Transmission',
      '✔ ALL4 All-Wheel Drive Capability',
    ].join('\n');

    expect(formatDescription(text)).toEqual([
      {
        kind: 'list',
        items: [
          'Rare John Cooper Works Performance Model',
          'Desirable 6-Speed Manual Transmission',
          'ALL4 All-Wheel Drive Capability',
        ],
      },
    ]);
  });

  it('treats a title-cased colon label as a heading without shouting', () => {
    const text = 'Premium Features Include:\n• Turbocharged Engine\n• 6-Speed Manual Transmission';

    expect(formatDescription(text)).toEqual([
      { kind: 'heading', text: 'Premium Features Include' },
      { kind: 'list', items: ['Turbocharged Engine', '6-Speed Manual Transmission'] },
    ]);
  });

  it('pulls a title-cased label off a run of checkmarks with no line break before it', () => {
    // The break between "Stands Out:" and the first checkmark was never
    // written, the same way a bullet run's own lead-in loses its line break.
    const text =
      'Why This MINI Stands Out:✔ Rare John Cooper Works Performance Model✔ Desirable 6-Speed Manual Transmission';

    expect(formatDescription(text)).toEqual([
      { kind: 'heading', text: 'Why This MINI Stands Out' },
      {
        kind: 'list',
        items: ['Rare John Cooper Works Performance Model', 'Desirable 6-Speed Manual Transmission'],
      },
    ]);
  });

  it('fixes a heading glued directly to the sentence that follows it', () => {
    // "Transmission If you're looking…" is one string in the feed, because the
    // break between the standalone feature and the paragraph was never
    // written.
    const text =
      "Manual Transmission If you're looking for something truly unique, this SUV blends comfort, practicality, and style.";

    expect(formatDescription(text)).toEqual([
      { kind: 'heading', text: 'Manual Transmission' },
      {
        kind: 'paragraph',
        text: "If you're looking for something truly unique, this SUV blends comfort, practicality, and style.",
      },
    ]);
  });

  it('does not cut a normal sentence that happens to start with capitalised words', () => {
    // "Toyota Corolla" is not a heading here — nothing after it is a sentence
    // opener, so the whole thing stays one paragraph.
    const text = 'Toyota Corolla owners love the reliability and low running costs of this model.';

    expect(formatDescription(text)).toEqual([{ kind: 'paragraph', text }]);
  });

  it('splits a section label out of a run of prose with only a sentence boundary before it', () => {
    const text = 'This vehicle has been fully inspected and serviced. Condition: Well maintained.';

    expect(formatDescription(text)).toEqual([
      { kind: 'paragraph', text: 'This vehicle has been fully inspected and serviced.' },
      { kind: 'heading', text: 'Condition' },
      { kind: 'paragraph', text: 'Well maintained.' },
    ]);
  });

  it('formats a realistic multi-section Seller Notes entry end to end', () => {
    const text = [
      'Manual Transmission',
      "If you're looking for something truly unique, this 2013 MINI Cooper Countryman John Cooper Works ALL4 is the perfect combination of performance, practicality, and iconic MINI styling.",
      '',
      'Premium Features Include:',
      '• Turbocharged John Cooper Works Engine',
      '• 6-Speed Manual Transmission',
      '• ALL4 All-Wheel Drive',
      '',
      'Why This MINI Stands Out:',
      '✔ Rare John Cooper Works Performance Model',
      '✔ Desirable 6-Speed Manual Transmission',
      '',
      'Condition:',
      '• Well maintained',
      '• Runs and drives excellent',
      '• Clean inside and out',
    ].join('\n');

    const blocks = formatDescription(text);

    expect(blocks.map((block) => block.kind)).toEqual([
      'heading',
      'paragraph',
      'heading',
      'list',
      'heading',
      'list',
      'heading',
      'list',
    ]);
    expect(blocks.map((block) => (block.kind !== 'list' ? block.text : null))).toEqual([
      'Manual Transmission',
      "If you're looking for something truly unique, this 2013 MINI Cooper Countryman John Cooper Works ALL4 is the perfect combination of performance, practicality, and iconic MINI styling.",
      'Premium Features Include',
      null,
      'Why This MINI Stands Out',
      null,
      'Condition',
      null,
    ]);
    expect(blocks[3]).toMatchObject({
      kind: 'list',
      items: [
        'Turbocharged John Cooper Works Engine',
        '6-Speed Manual Transmission',
        'ALL4 All-Wheel Drive',
      ],
    });
    expect(blocks[7]).toMatchObject({
      kind: 'list',
      items: ['Well maintained', 'Runs and drives excellent', 'Clean inside and out'],
    });

    // Every word survives — only the markers that became structure (bullets,
    // checkmarks, blank lines, the colon after a label) are consumed.
    expect(flatten(text)).toEqual(words(text));
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
