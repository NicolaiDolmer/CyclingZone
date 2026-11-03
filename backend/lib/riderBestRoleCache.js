// #7560: bedste-rolle-reglen (bestRoleForAbilities) og fødsels-cachen
// (writeBestRoleCacheForRiders), udskilt fra riderValueRefresh.js så
// starter-squad-allokeringen kan skrive cachen uden at importere hele
// værdi-kæden. riderValueRefresh re-eksporterer begge og bruger samme
// skrive-hjælper (writeRiderPatches), så sweepen og fødslen skriver ens.
import { fetchAllRows } from "./supabasePagination.js";
import { VALUATION_ABILITY_COLUMNS } from "./riderValuation.js";
import { DISPLAY_RECIPE_KEYS, ratingForRole } from "./weights/displayRecipes.js";

const WRITE_CONCURRENCY = 25;

// Data-only preparation for #5435/#5443. Neither natural identity nor the active
// valuation model reads these fields yet.
//
// #7560 tie-break: the rating is the maximum of the rounded role ratings, and
// that number never depends on the tie-break. Only the LABEL does: when several
// roles share the maximum, the rider's natural role wins (primaryType), then his
// secondary type, and only then the stable recipe order. Before #7560 the recipe
// order alone decided, so a flat starter profile always read "sprinter" no
// matter what kind of rider he was. Without types the result is bit-identical
// to the old rule. The frontend mirror is riderRating.riderBestRole; the two
// must stay the same rule (riderBestRole.test.js + riderRating.test.js).
/**
 * @param {Record<string, unknown> | null | undefined} abilities
 * @param {{ primaryType?: string | null, secondaryType?: string | null }} [types]
 * @returns {{ best_role: string | null, best_role_rating: number | null }}
 */
export function bestRoleForAbilities(abilities, { primaryType = null, secondaryType = null } = {}) {
  /** @type {string | null} */
  let best_role = null;
  /** @type {number | null} */
  let best_role_rating = null;
  /** @type {Array<string | null>} */
  const tied = [];
  for (const role of DISPLAY_RECIPE_KEYS) {
    const rating = ratingForRole(abilities, role);
    if (rating === null) continue;
    if (best_role_rating === null || rating > best_role_rating) {
      best_role = role;
      best_role_rating = rating;
      tied.length = 0;
      tied.push(role);
    } else if (rating === best_role_rating) {
      tied.push(role);
    }
  }
  if (tied.length > 1) {
    if (tied.includes(primaryType)) best_role = primaryType;
    else if (tied.includes(secondaryType)) best_role = secondaryType;
  }
  return { best_role, best_role_rating };
}

// #7560 side finding: a rider's best-role cache was only ever written by the
// weekly value sweep, so a squad born mid-week showed an empty cache until the
// next Sunday. Starter-squad allocation calls this right after the derive chain
// so a new team reads correctly from its first page load. Reads the freshly
// derived abilities + types and writes ONLY best_role/best_role_rating, through
// the same bestRoleForAbilities the sweep uses (so the sweep is a no-op after).
export async function writeBestRoleCacheForRiders(supabase, riderIds) {
  if (!riderIds || riderIds.length === 0) return 0;
  const ids = [...riderIds];
  const riders = await fetchAllRows(() =>
    // schema-columns-ok: best_role fields added by 2026-09-22-5443-best-role-data.sql.
    supabase.from("riders").select("id, primary_type, secondary_type, best_role, best_role_rating").in("id", ids).order("id"));
  const abilities = await fetchAllRows(() =>
    supabase.from("rider_derived_abilities").select(`rider_id, ${VALUATION_ABILITY_COLUMNS.join(", ")}`).in("rider_id", ids).order("rider_id"));
  const abilityByRider = new Map(abilities.map((a) => [a.rider_id, a]));
  const updates = [];
  for (const r of riders) {
    const ab = abilityByRider.get(r.id);
    if (!ab) continue;
    const best = bestRoleForAbilities(ab, { primaryType: r.primary_type, secondaryType: r.secondary_type });
    if (best.best_role === (r.best_role ?? null) && best.best_role_rating === (r.best_role_rating ?? null)) continue;
    updates.push({ id: r.id, ...best });
  }
  return writeRiderPatches(supabase, updates);
}

// Skriv patches i batches à WRITE_CONCURRENCY (id + øvrige felter pr. rytter).
export async function writeRiderPatches(supabase, updates) {
  let written = 0;
  for (let i = 0; i < updates.length; i += WRITE_CONCURRENCY) {
    const batch = updates.slice(i, i + WRITE_CONCURRENCY);
    await Promise.all(
      batch.map(({ id, ...patch }) =>
        supabase.from("riders").update(patch).eq("id", id).then(({ error }) => {
          if (error) throw new Error(`riders update ${id}: ${error.message}`);
        })
      )
    );
    written += batch.length;
  }
  return written;
}
