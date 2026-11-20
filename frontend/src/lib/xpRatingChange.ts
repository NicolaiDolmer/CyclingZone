// #7947 · "Rating 34 > 35" on a folded rider in the XP report (owner yes 19/11 to a
// player's idea). The receipt carries each new point as { from, to } per ability
// (gains_detail); the rider's other abilities come from the roster. Before and
// after are the same best-role rating the rest of the game shows (riderBestRole),
// computed on the rider's abilities with the date's jumps set to `from` and to `to`.
// The roster is the rider NOW, so it only describes the state after the newest date:
// the report asks for that date alone, and a roster whose jumped abilities no longer
// stand at `to` (it moved on) gives nothing. There is no ability snapshot per date,
// so an older date shows nothing rather than a number built on later abilities
// (Codex P2 on #8488).
//
// Pure, no React. null = nothing to show: no abilities, no usable jump, a roster
// past the date, or the rating did not change (never "34 > 34").
import { riderBestRole } from "./riderRating.js";
import { abilityValue } from "./generated/displayRecipes.js";

export interface RatingChange { from: number; to: number }
type Jump = { from?: unknown; to?: unknown } | null | undefined;
export type RosterAbilities = Record<string, unknown>;

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

export function ratingChange(
  abilities: RosterAbilities | null | undefined,
  detail: Record<string, Jump> | null | undefined,
): RatingChange | null {
  if (!abilities || typeof abilities !== "object" || !detail || typeof detail !== "object") return null;
  const jumps = Object.entries(detail).filter((entry): entry is [string, { from: number; to: number }] =>
    finite(entry[1]?.from) && finite(entry[1]?.to) && entry[1].to !== entry[1].from);
  // The roster row must carry the rider's abilities (flattened) and stand exactly where
  // the date left them; a jump alone would rate the rider on one ability and invent a number.
  if (jumps.length === 0 || !jumps.every(([key, jump]) => abilityValue(abilities[key]) === jump.to)) return null;
  // The cached best_role_rating is a fallback for rows without abilities; it would
  // read the same before and after, so it is left out on purpose.
  const before: Record<string, unknown> = { ...abilities };
  delete before.best_role_rating;
  delete before.best_role;
  const after: Record<string, unknown> = { ...before };
  for (const [key, jump] of jumps) { before[key] = jump.from; after[key] = jump.to; }
  const from = riderBestRole(before).rating;
  const to = riderBestRole(after).rating;
  if (!finite(from) || !finite(to) || from === to) return null;
  return { from, to };
}
