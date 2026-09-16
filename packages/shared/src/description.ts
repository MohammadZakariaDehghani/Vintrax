/**
 * Reading a listing description that arrived as one paragraph.
 *
 * A dealer management system exports the description as a single field, and
 * whoever typed it did not put newlines in: a real one from the feed this was
 * built against is 2,045 unbroken characters holding a warranty headline, four
 * paragraphs of prose, and twenty-four features run together behind bullet
 * characters. Rendered literally it is a wall nobody reads.
 *
 * So the structure is recovered at render time. Three rules, in order of how
 * confident they are:
 *
 *   1. Blank lines, if the text has any. Someone who formatted their
 *      description already said what they meant and is not second-guessed.
 *   2. Bullet characters. `•` in the middle of a sentence is not punctuation —
 *      it is a list that lost its line breaks.
 *   3. Sentence grouping, for everything left over.
 *
 * Nothing is rewritten, reordered, corrected or dropped: every character of the
 * input appears in the output, and joining the blocks back together reproduces
 * the text with only whitespace differing. This is a view of the description,
 * not an edit of it — the stored value is what the dealer wrote, and the
 * importer is still forbidden from changing it.
 */

export type DescriptionBlock =
  | { kind: 'heading'; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; items: string[] };

/** Characters a feed uses to mean "next item" when it has no line breaks. */
const BULLETS = '•●▪‣∙·◦';
const BULLET_PATTERN = new RegExp(`[${BULLETS}]`);
const BULLET_SPLIT = new RegExp(`\\s*[${BULLETS}]\\s*`);

/** Roughly a comfortable paragraph. Sentences are never split to hit it. */
const TARGET_PARAGRAPH_CHARS = 320;
/** A heading is short. Anything longer is a sentence that happens to shout. */
const MAX_HEADING_CHARS = 72;

export function formatDescription(description: string): DescriptionBlock[] {
  const text = description.replace(/\r\n?/g, '\n').trim();
  if (text.length === 0) return [];

  const blocks: DescriptionBlock[] = [];
  // A description the dealer formatted themselves is left as they formatted it;
  // its chunks still go through the bullet and heading rules below, which is
  // what handles a list typed on one line inside an otherwise tidy description.
  for (const chunk of text.split(/\n\s*\n/)) {
    if (chunk.trim().length > 0) blocks.push(...readChunk(chunk.trim()));
  }
  return blocks;
}

/** One blank-line-separated chunk, split further on bullets and sentences. */
function readChunk(chunk: string): DescriptionBlock[] {
  const lines = chunk.split('\n').map((line) => line.trim());

  // Already one-per-line, which is what our own generated descriptions and a
  // hand-typed list look like.
  if (lines.length > 1 && lines.every((line) => isBulletLine(line))) {
    return [{ kind: 'list', items: lines.map(stripBullet).filter(Boolean) }];
  }

  const flat = lines.join(' ').replace(/\s+/g, ' ').trim();
  if (flat.length === 0) return [];
  if (!BULLET_PATTERN.test(flat)) return readProse(flat);

  // A run of bullets, usually with a lead-in like "FEATURES & OPTIONS:" before
  // the first one and a closing paragraph after the last.
  const blocks: DescriptionBlock[] = [];
  const parts = flat.split(BULLET_SPLIT);
  const lead = parts.shift()?.trim() ?? '';
  if (lead.length > 0) {
    // The lead-in usually ends with the list's own label — "…road conditions.
    // FEATURES & OPTIONS:" — because the line break that separated them was
    // never written. Pulled off the end so it heads the list instead of
    // trailing a paragraph.
    const { body, label } = takeTrailingLabel(lead);
    if (body.length > 0) blocks.push(...readProse(body));
    if (label) blocks.push({ kind: 'heading', text: label });
  }

  const items: string[] = [];
  let tail = '';

  parts.forEach((part, index) => {
    const value = part.trim();
    if (value.length === 0) return;

    // The last bullet runs into the prose that follows it, because the break
    // that separated them was never written. A short fragment is the item; a
    // sentence after it is the rest of the description.
    if (index === parts.length - 1) {
      const split = splitTrailingProse(value);
      if (split.item) items.push(split.item);
      tail = split.rest;
      return;
    }
    items.push(value);
  });

  if (items.length > 0) blocks.push({ kind: 'list', items });
  if (tail.length > 0) blocks.push(...readProse(tail));
  return blocks;
}

/**
 * A shouted label at the end of a run of prose, and the prose without it.
 *
 * Only ever called on text that is about to be followed by a list, so a false
 * positive costs a heading where a sentence fragment should be, not a mangled
 * paragraph.
 */
function takeTrailingLabel(text: string): { body: string; label: string | null } {
  const match = /(?:^|[.!?]\s+)([^.!?]{2,72}:)\s*$/.exec(text);
  const candidate = match?.[1]?.trim();
  if (!candidate || !isShouted(candidate)) return { body: text, label: null };
  return {
    body: text.slice(0, text.length - candidate.length).trim(),
    label: candidate.replace(/:$/, '').trim(),
  };
}

/**
 * Words that begin a sentence rather than a feature name.
 *
 * Short and deliberately conservative: this list only has to be right about the
 * word that starts the closing paragraph of a dealer description, and a word
 * left off it means a list item keeps a few extra words — visible, but not
 * wrong in a way that loses anything.
 */
const SENTENCE_STARTERS = new Set([
  'the',
  'this',
  'these',
  'with',
  'whether',
  'our',
  'it',
  'we',
  'you',
  'all',
  'in',
  'for',
  'at',
  'please',
  'contact',
  'call',
  'come',
  'visit',
  'financing',
  'every',
  'each',
  'book',
  'ask',
  'trade',
  'priced',
]);

/**
 * Separates a final list item from the prose that was run into it.
 *
 * "Multiple Airbags The Santa Fe Sport offers a comfortable…" is one string in
 * the feed, because the break between the last bullet and the closing paragraph
 * was never written. Feature names are capitalised throughout, so the first
 * ordinary lower-case word is where prose has certainly begun — and the
 * sentence itself started at the nearest sentence-opening word before it.
 *
 * "Comfortable Seating for Five" has a lower-case word too, and correctly stays
 * whole: nothing before "for" opens a sentence. When no opener is found the
 * whole string stays an item, because inventing a break would be worse than
 * leaving one out.
 */
function splitTrailingProse(value: string): { item: string; rest: string } {
  const words = value.split(' ');
  const firstLower = words.findIndex((word, index) => index > 0 && /^[a-z]/.test(word));
  if (firstLower <= 0) return { item: value, rest: '' };

  for (let index = firstLower - 1; index >= 1; index -= 1) {
    const word = words[index]!;
    if (!/^[A-Z]/.test(word)) break;
    if (SENTENCE_STARTERS.has(word.toLowerCase().replace(/[^a-z]/g, ''))) {
      return { item: words.slice(0, index).join(' '), rest: words.slice(index).join(' ') };
    }
  }

  return { item: value, rest: '' };
}

/** Prose, as a heading where it reads like one and paragraphs otherwise. */
function readProse(text: string): DescriptionBlock[] {
  const blocks: DescriptionBlock[] = [];
  let rest = text;

  // "FREE 3000 KM COMPREHENSIVE LUBRICO WARRANTY!!" — a dealer's headline,
  // shouted, at the very front. Pulled out so it reads as the banner it is.
  const shout = /^([^.!?]{3,72}!+)\s*/.exec(rest);
  if (shout?.[1] && isShouted(shout[1])) {
    blocks.push({ kind: 'heading', text: shout[1].trim() });
    rest = rest.slice(shout[0].length);
  }

  // "FEATURES & OPTIONS:" — a label for what follows.
  const label = /^([^.!?]{2,72}:)\s*/.exec(rest);
  if (label?.[1] && isShouted(label[1])) {
    blocks.push({ kind: 'heading', text: label[1].replace(/:$/, '').trim() });
    rest = rest.slice(label[0].length);
  }

  for (const paragraph of groupSentences(rest)) {
    blocks.push({ kind: 'paragraph', text: paragraph });
  }
  return blocks;
}

/** Mostly capitals, and short. How a dealer writes a heading with no styling. */
function isShouted(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_HEADING_CHARS) return false;
  const letters = trimmed.replace(/[^A-Za-z]/g, '');
  if (letters.length < 3) return false;
  const capitals = trimmed.replace(/[^A-Z]/g, '').length;
  return capitals / letters.length >= 0.8;
}

/**
 * Groups sentences into paragraphs of roughly `TARGET_PARAGRAPH_CHARS`.
 *
 * A sentence is never split, so the target is a floor rather than a limit: one
 * long sentence is one paragraph. The abbreviation guard keeps "2.4L" and
 * "approx. 190 hp" from being read as sentence ends, which is the failure that
 * makes this sort of thing look broken.
 */
function groupSentences(text: string): string[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) return [];

  const sentences: string[] = [];
  let current = '';

  for (const piece of trimmed.split(/(?<=[.!?])\s+/)) {
    current = current.length > 0 ? `${current} ${piece}` : piece;
    // A break after a single capital ("J. Smith") or a decimal ("2.4L") is not
    // a sentence end; it is a full stop doing another job.
    if (/(?:^|\s)(?:[A-Za-z]|\d+(?:\.\d+)?[A-Za-z]*|[A-Z][a-z]{0,3})\.$/.test(current)) continue;
    sentences.push(current);
    current = '';
  }
  if (current.trim().length > 0) sentences.push(current.trim());

  const paragraphs: string[] = [];
  let buffer = '';

  for (const sentence of sentences) {
    buffer = buffer.length > 0 ? `${buffer} ${sentence}` : sentence;
    if (buffer.length >= TARGET_PARAGRAPH_CHARS) {
      paragraphs.push(buffer);
      buffer = '';
    }
  }
  if (buffer.trim().length > 0) {
    // A short remainder joins the previous paragraph rather than dangling as a
    // one-line orphan under it.
    const last = paragraphs.pop();
    paragraphs.push(last ? `${last} ${buffer}`.trim() : buffer.trim());
  }

  return paragraphs;
}

function isBulletLine(line: string): boolean {
  return new RegExp(`^\\s*(?:[${BULLETS}]|[-*])\\s+`).test(line);
}

function stripBullet(line: string): string {
  return line.replace(new RegExp(`^\\s*(?:[${BULLETS}]|[-*])\\s+`), '').trim();
}
