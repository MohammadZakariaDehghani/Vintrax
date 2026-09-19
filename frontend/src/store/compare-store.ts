'use client';

import { create } from 'zustand';
import { MAX_COMPARE_VEHICLES, readCompareIds, writeCompareIds } from '@/lib/compare-storage';

export { MAX_COMPARE_VEHICLES };

export type CompareNotice =
  | { kind: 'added'; token: number }
  | { kind: 'removed'; token: number }
  | { kind: 'limit'; token: number }
  | { kind: 'cleared'; token: number };

interface CompareState {
  ids: string[];
  /** The most recent thing that happened, for `CompareToast` to announce and then dismiss. Not persisted — it is a one-shot event, not state. */
  notice: CompareNotice | null;
  add: (id: string) => void;
  remove: (id: string) => void;
  toggle: (id: string) => void;
  clear: () => void;
  dismissNotice: () => void;
}

let noticeToken = 0;
const nextToken = () => (noticeToken += 1);

/**
 * The vehicle comparison list, shared across every card, row, detail page and
 * the floating compare tray — the same reason `auth-store.ts` is a Zustand
 * store rather than component state: this is read "from deep in the tree"
 * simultaneously by many components that have no other relationship to each
 * other.
 *
 * `ids` starts empty on both the server and the client's first render, and is
 * filled in from `localStorage` by `useHydrateCompareStore` after mount —
 * constructing this module runs during server rendering too, which has no
 * `localStorage`, so seeding it here directly would either crash the server
 * render or disagree with what the client then hydrates to.
 */
export const useCompareStore = create<CompareState>((set, get) => ({
  ids: [],
  notice: null,

  add: (id) => {
    const { ids } = get();
    if (ids.includes(id)) return;
    if (ids.length >= MAX_COMPARE_VEHICLES) {
      set({ notice: { kind: 'limit', token: nextToken() } });
      return;
    }
    const next = [...ids, id];
    writeCompareIds(next);
    set({ ids: next, notice: { kind: 'added', token: nextToken() } });
  },

  remove: (id) => {
    const next = get().ids.filter((existing) => existing !== id);
    writeCompareIds(next);
    set({ ids: next, notice: { kind: 'removed', token: nextToken() } });
  },

  toggle: (id) => {
    const { ids, add, remove } = get();
    if (ids.includes(id)) remove(id);
    else add(id);
  },

  clear: () => {
    writeCompareIds([]);
    set({ ids: [], notice: { kind: 'cleared', token: nextToken() } });
  },

  dismissNotice: () => set({ notice: null }),
}));

/** Loads whatever was saved from a previous visit. Called once, by `CompareBar`, which is mounted globally regardless of page. */
export function hydrateCompareStore(): void {
  const stored = readCompareIds();
  if (stored.length > 0) useCompareStore.setState({ ids: stored });
}

export function useCompareIds(): string[] {
  return useCompareStore((state) => state.ids);
}

export function useIsInCompare(id: string): boolean {
  return useCompareStore((state) => state.ids.includes(id));
}

export function useCompareCount(): number {
  return useCompareStore((state) => state.ids.length);
}
