import { useEffect, useState } from 'react';

/**
 * Subscribes to a CSS media query from React.
 *
 * Layout that only needs to *look* different belongs in the stylesheet; this is
 * for cases where the component tree itself should differ — on narrow screens
 * the filter panel becomes a collapsed disclosure rather than a sidebar, so
 * results are the first thing on screen.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia(query).matches,
  );

  useEffect(() => {
    const list = window.matchMedia(query);
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);

    // Re-read on subscribe in case the viewport changed between render and effect.
    setMatches(list.matches);
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

/** Matches the 900px breakpoint the search layout collapses at in styles.css. */
export const useIsNarrowViewport = () => useMediaQuery('(max-width: 900px)');
