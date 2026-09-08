import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every internal link points at a page that exists.
 *
 * The web app had three dead links — a thread, the notification bell and an
 * order — and nothing failed: the App Router simply rendered "Page not found",
 * so the only way to notice was to click. This app is clean today; the check is
 * here so it stays that way.
 *
 * A route file is not proof the page works, but a missing one is proof it
 * cannot.
 */

const SRC = fileURLToPath(new URL('..', import.meta.url));
const APP = join(SRC, 'app');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

/**
 * Route patterns the App Router serves, as segment arrays. A `[slug]` segment
 * is kept as-is and matched as a wildcard below.
 */
function routePatterns(): string[][] {
  return walk(APP)
    .filter((path) => /[/\\]page\.tsx$/.test(path))
    .map((path) =>
      relative(APP, path)
        .split(sep)
        .slice(0, -1)
        // Route groups — (marketing) — organise files without adding a segment.
        .filter((segment) => segment !== '' && !segment.startsWith('(')),
    );
}

/** Internal link targets written anywhere in the app, as segment arrays. */
function linkTargets(): Array<{ segments: string[]; href: string; file: string }> {
  const found: Array<{ segments: string[]; href: string; file: string }> = [];

  for (const file of walk(SRC)) {
    if (!/\.tsx?$/.test(file) || /\.spec\.tsx?$/.test(file)) continue;
    const source = readFileSync(file, 'utf8');

    // Template holes become a placeholder segment, since any value could
    // appear there. `href="/x"`, `href={`/x/${id}`}` and `router.push('/x')` alike. The
    // brace matters: a JSX expression attribute is how most dynamic links are
    // written, and a pattern that only accepts a bare quote silently skips
    // every one of them.
    const pattern = /(?:href=\{?|router\.(?:push|replace)\(\s*)\s*[`'"](\/[^`'"?#]*)/g;
    for (const match of source.matchAll(pattern)) {
      const href = match[1]!;
      const segments = href
        .replace(/\$\{[^}]*\}/g, ':param')
        .split('/')
        .filter(Boolean);
      found.push({ segments, href, file: relative(SRC, file) });
    }
  }
  return found;
}

/** Whether one route pattern serves this link. */
function serves(pattern: string[], link: string[]): boolean {
  // A catch-all absorbs the rest of the path.
  const catchAll = pattern.findIndex((segment) => segment.startsWith('[...'));
  if (catchAll !== -1) return link.length >= catchAll;

  if (pattern.length !== link.length) return false;
  return pattern.every(
    (segment, index) => segment.startsWith('[') || segment === link[index],
  );
}

describe('internal links', () => {
  const patterns = routePatterns();
  const links = linkTargets();

  it('finds the app router pages, so the check is not passing on an empty set', () => {
    expect(patterns.length).toBeGreaterThan(10);
    expect(patterns).toContainEqual(['messages', '[id]']);
  });

  it('finds the links, including ones built from a template literal', () => {
    expect(links.length).toBeGreaterThan(10);
    expect(links.some((link) => link.href.includes('${'))).toBe(true);
  });

  it('every one resolves to a page', () => {
    const dead = links
      .filter((link) => !patterns.some((pattern) => serves(pattern, link.segments)))
      .map((link) => `${link.file} → ${link.href}`);

    expect([...new Set(dead)]).toEqual([]);
  });

  it('serves() distinguishes a real match from a near miss', () => {
    expect(serves(['messages', '[id]'], ['messages', ':param'])).toBe(true);
    expect(serves(['messages'], ['messages', ':param'])).toBe(false);
    expect(serves(['vehicles', '[slug]'], ['vehicles', 'a-b-c'])).toBe(true);
    expect(serves(['vehicles', '[slug]'], ['auctions', 'a-b-c'])).toBe(false);
  });
});
