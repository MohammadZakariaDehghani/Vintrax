import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * No server component may pass a DOM event handler.
 *
 * This is the shape of issue #37 rather than the instance of it. `CarfaxBadge`
 * was written without `'use client'` — correctly, it is an anchor with a URL in
 * it — and then given an `onClick`. Every page that rendered it from the server
 * failed at render with "Event handlers cannot be passed to Client Component
 * props", because a function cannot be serialised across that boundary.
 *
 * What makes it worth a structural test is how it got through: typecheck, lint
 * and `next build` were all green, because the file is valid on its own and the
 * two list components that used it are client components. Only the one
 * server-rendered page that used it broke, and only at request time. A test
 * that reads the source is the cheapest thing that fails in CI instead.
 *
 * The rule it enforces is the actual React rule: a file without `'use client'`
 * is a server component, and a server component may not hand a function to a
 * DOM prop. Adding `'use client'` is always an available answer — the test then
 * passes because the file really is a client component.
 */

const ROOTS = ['src/app', 'src/components'];

/**
 * Handler props, not every prop starting with "on".
 *
 * Deliberately a fixed list rather than `/on[A-Z]/`: that pattern matches
 * `auctionId={id}` in the middle of a word, which is how a first attempt at
 * this sweep produced a false positive and nearly sent me to the wrong file.
 */
const HANDLER = new RegExp(
  String.raw`\bon(Click|DoubleClick|Change|Input|Submit|Reset|Focus|Blur|KeyDown|KeyUp|KeyPress|MouseDown|MouseUp|MouseEnter|MouseLeave|MouseOver|Pointer\w+|Touch\w+|Drag\w+|Drop|Scroll|Wheel|Select|Toggle|Copy|Paste|Cut|Load|Error|Animation\w+|Transition\w+)=\{`,
);

function filesUnder(directory: string): string[] {
  const found: string[] = [];

  const walk = (path: string) => {
    for (const entry of readdirSync(path)) {
      const full = join(path, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (full.endsWith('.tsx') && !full.endsWith('.spec.tsx')) found.push(full);
    }
  };

  walk(directory);
  return found;
}

describe('the server/client boundary', () => {
  const files = ROOTS.flatMap((root) => filesUnder(root));

  it('finds files to check, so a silent zero cannot pass', () => {
    // A path change that made the walk return nothing would otherwise turn this
    // whole suite green and prove nothing.
    expect(files.length).toBeGreaterThan(20);
  });

  it('never passes an event handler from a component without "use client"', () => {
    const offenders = files.filter((file) => {
      const source = readFileSync(file, 'utf8');
      if (/^['"]use client['"]/m.test(source)) return false;
      return HANDLER.test(source);
    });

    // Named rather than counted, so a failure says which file to open.
    expect(offenders).toEqual([]);
  });

  it('recognises a client component by its directive', () => {
    // Guards the check itself: if the directive test broke, the rule above
    // would pass for every file and catch nothing.
    const clients = files.filter((file) => /^['"]use client['"]/m.test(readFileSync(file, 'utf8')));

    expect(clients.length).toBeGreaterThan(10);
  });
});
