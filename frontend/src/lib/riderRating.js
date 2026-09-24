// Rating-SSOT'en for rytter-visning. ÉN beregning, alle flader.
//
// STAT_KEYS = evne-keys (delt config i ./abilities.js). components/
// RiderFilters.jsx re-eksporterer den. ./abilities.js er ren .js uden JSX-imports,
// så `node --test` kan stadig loade denne fil. Rytter-objektet skal have evnerne
// fladet op (rider.climbing osv.) via flattenAbilities() før rating beregnes.
//
// #5321: `riderStatRating` — et uvægtet snit af ALLE evner — lå her indtil 17/9
// og var den sidste konkurrerende rating-formel i frontenden. Den blev brugt ét
// sted (træningssidens rytterrække uden prognose-bånd) og gav dér et andet tal
// for samme rytter end alle andre flader. Den er fjernet, ikke deprecated: så
// længe der findes to eksporterede måder at regne en rating på, bliver den
// forkerte samlet op igen. Skal et andet mål vises, skal det have sin egen
// etiket — ikke ordet "rating".
import { ABILITY_KEYS } from "./abilities.js";
import { DISPLAY_RECIPE_KEYS, ratingForRole } from "./generated/displayRecipes.js";
import { isBestRoleDisplayOn } from "./riderRatingMode.js";

export const STAT_KEYS = ABILITY_KEYS;

// ============================================================================
// #3666 — DEN NYE MODEL. Signaturerne er UÆNDREDE med vilje.
// ============================================================================
//
// rating(rytter, rolle) = vægtet snit af rollens evner (weights/displayRecipes),
// afrundet, klampet [0,99]. Ingen normalisering, ingen kurve, ingen ankre:
// 13 i alle evner der tæller → rating 13. Tallet afhænger kun af rytterens egne
// evner, så der findes ikke længere et "hvorfor faldt mit tal da der kom nye
// ryttere".
//
// Opskrifterne kommer fra ./generated/displayRecipes.js, som er GENERERET fra
// backend-kilden af scripts/generate-ability-registry.mjs og drift-vagtet i det
// required backend-tests-check. Den håndholdte RATING_TYPE_WEIGHTS der lå her
// før var rod-årsagen i spec §1.5 — og var allerede drevet fra backend
// (cobblestone 5 mod 6, et climbing:1-krydsled som #3325 havde fjernet, flat 2
// mod 4) uden at noget fejlede. Den er væk nu, og drift-vagten gør den umulig.
//
// De to funktioner beholder deres navne og argumenter, fordi ~20 kaldsteder på
// tværs af hero, fire tabeller, fire planner-flader, radaren og Udvikling-fanen
// bruger dem. Ved at skifte IMPLEMENTERINGEN i stedet for kaldstederne flytter
// alle flader sig i præcis samme commit — det er den tekniske garanti bag spec
// §D4's krav om at der aldrig må findes en mellemtilstand med to skalaer.
//
// KONTRAKT-ÆNDRING kaldere skal kende: bunden er 0, ikke 1. Den gamle skala
// kunne ikke producere 0; den nye kan, og målt read-only mod prod 13/8 er der 2
// levende ryttere hvis rolle-rating er præcis 0. De skal vise 0 — ikke skjules
// af en `ovr > 0`-gate som "ingen data". Kan ratingen slet ikke beregnes
// (rytteren har ingen af rollens evner på rækken) returneres null.

// "Hvor højt ville rytteren rates SOM `typeKey`" — bruges af Udvikling-fanens
// linjer og af radarens 8 akser.
export function riderTypeRating(rider = {}, typeKey = null) {
  return ratingForRole(rider, typeKey);
}

// #5435 (D-049) — "Best role now / Bedste rolle nu": den rolle rytteren rates
// højest som LIGE NU, og det tal. Samme regel som backendens cache
// (riderValueRefresh.bestRoleForAbilities, ECONOMY_RULES "Datakontrakt 1a"):
// maksimum af de AFRUNDEDE rolle-ratings; ved lighed vinder første rolle i
// opskrifternes faste rækkefølge (strengt `>`); ingen brugbare evner → null.
//
// Kilde: beregnes fra rækkens live evner når de findes, så tallet altid er det
// samme som radaren og scouting-fanens nu-tal på samme side. Den cachede
// riders.best_role/best_role_rating bruges kun når rækken ikke bærer evner
// (fx lette lister); cachen følger værdi-refreshens kadence og kan halte en
// træningsdag efter de live evner.
export function riderBestRole(rider = {}) {
  let role = null;
  let rating = null;
  for (const key of DISPLAY_RECIPE_KEYS) {
    const r = ratingForRole(rider, key);
    if (r !== null && (rating === null || r > rating)) {
      role = key;
      rating = r;
    }
  }
  if (rating !== null) return { rating, role };
  const cachedRating = rider?.best_role_rating;
  const cachedRole = rider?.best_role;
  if (Number.isFinite(cachedRating) && DISPLAY_RECIPE_KEYS.includes(cachedRole)) {
    return { rating: cachedRating, role: cachedRole };
  }
  return { rating: null, role: null };
}

// Det tal der står på kortet. Kontakten (riderRatingMode.js) vælger model:
//   off — rytterens EGEN rolle (primary_type), som før #5435.
//   on  — bedste rolle nu (riderBestRole). Kan kun hæve tallet: egen rolle er
//         én af de otte, så max over dem er ≥ (ejer-regel 17/9).
// Rytter-objektet skal have evnerne fladet op (rider.climbing osv.) via
// flattenAbilities().
export function riderOverallRating(rider = {}) {
  if (isBestRoleDisplayOn()) return riderBestRole(rider).rating;
  return ratingForRole(rider, rider?.primary_type ?? null);
}
