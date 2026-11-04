/**
 * #1857: one shared, locale-independent string comparator for the race engines.
 *
 * Why: `a.localeCompare(b)` without a locale follows the PROCESS default
 * locale. Railway (Linux) collates as en-US; a Danish Windows machine collates
 * as da-DK, where "aa" is read as the letter "å" and sorts after "z". A UUID
 * containing "aa" then swaps places with its neighbour, and a replay or a
 * local calibration run no longer matches the stored prod output.
 *
 * The collation is pinned to "en-US" (the locale prod has always run with), so
 * prod output is unchanged while every other machine now sorts the same way.
 * Not a plain `<` comparison on purpose: that would reorder mixed-case and
 * punctuation ids relative to what prod has produced so far.
 *
 * Use it for ids AND for display names in engine/race code. The guard
 * scripts/check-locale-compare.mjs rejects an argument-less `localeCompare`
 * in backend/lib/engine/** and the race engine files.
 */
export const ENGINE_COLLATION_LOCALE = "en-US";

export function compareIds(a: string, b: string): number {
  return a.localeCompare(b, ENGINE_COLLATION_LOCALE);
}
