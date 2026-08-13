// Display-rating 0-99 for en rytter: simpelt, uvægtet snit af de 15 synlige
// CZ-evner (#1529). Frontend-pendant til backend `riderOverall`
// (backend/lib/riderValuation.js), som også arbejder på derived abilities.
//
// STAT_KEYS = de 15 evne-keys (delt config i ./abilities.js). Migreret 2026-06-19
// (#1529) fra de 14 PCM stat_*-kolonner — visningen viser nu evner. components/
// RiderFilters.jsx re-eksporterer den. ./abilities.js er ren .js uden JSX-imports,
// så `node --test` kan stadig loade denne fil. Rytter-objektet skal have evnerne
// fladet op (rider.climbing osv.) via flattenAbilities() før rating beregnes.
import { ABILITY_KEYS } from "./abilities.js";
import { ratingForRole } from "./generated/displayRecipes.js";

export const STAT_KEYS = ABILITY_KEYS;

// Snit af de stats der findes på rækken (manglende/ikke-numeriske ignoreres).
// Ingen stats overhovedet → 0 (sorterer nederst, viser tomt-agtig værdi).
export function riderStatRating(rider = {}) {
  let sum = 0;
  let n = 0;
  for (const k of STAT_KEYS) {
    const raw = rider?.[k];
    if (raw == null) continue; // null/undefined = manglende stat, ikke 0 (Number(null) er 0)
    const v = Number(raw);
    if (Number.isFinite(v)) {
      sum += v;
      n += 1;
    }
  }
  if (n === 0) return 0;
  return Math.round(Math.max(0, Math.min(99, sum / n)));
}


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

// Rating for rytterens EGEN rolle. Rytter-objektet skal have evnerne fladet op
// (rider.climbing osv.) via flattenAbilities().
export function riderOverallRating(rider = {}) {
  return ratingForRole(rider, rider?.primary_type ?? null);
}
