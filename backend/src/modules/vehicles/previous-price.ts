/**
 * What to write alongside a price change so the listing can show the old
 * price struck through: the price being replaced, when the new one differs.
 * Saving the same price, or not touching the price, writes nothing, so an
 * unrelated edit does not wipe a price drop the listing is showing.
 *
 * Shared by the edit form, the quick price edit (both `PATCH /vehicles/:id`)
 * and the CSV import, so the three cannot disagree.
 */
export function previousPriceUpdate(
  currentPriceCad: number | null | undefined,
  nextPriceCad: number | undefined,
): { previousPriceCad?: number } {
  if (nextPriceCad === undefined || currentPriceCad === null || currentPriceCad === undefined) {
    return {};
  }
  return currentPriceCad === nextPriceCad ? {} : { previousPriceCad: currentPriceCad };
}
