// Delt evne-config — ÉN kilde til sandhed for de 15 viste CZ-evner (#1122/#1529).
// Erstatter de tidligere pr-side STATS/LISTING_STATS PCM-konstanter. PCM-stats
// (riders.stat_*) bliver i datamodellen som derive-kilde (backend/lib/abilityDerivation.js);
// kun VISNINGEN bruger disse evner. Ren .js uden JSX-imports, så `node --test` kan loade.
//
// Rækkefølge = ejer-bekræftet kategori-gruppering (Physical → Mental → Technical),
// jf. EPIC #2000 slice 1. `prolog` er udeladt (merget i time_trial per
// abilityDerivation). Korte labels = kolonne-overskrifter (oversættes ikke, jf.
// #487); fulde navne via i18n rider.json racePreview.derived.<key>.

// #3665: kategori-gruppering, keys, korte labels og ikoner er nu GENERERET fra
// backendens evne-registry (backend/lib/abilityRegistry.js) i stedet for at være
// fire håndholdte literaler her. Indholdet er byte-for-byte det samme som før;
// kun kilden har flyttet sig. Regenerér med:
//   node scripts/generate-ability-registry.mjs
// Rækkefølgen af grupperne OG nøglerne i hver gruppe er fortsat ejer-bekræftet
// (#2000) — den bor nu som `displayOrder` på registry-posterne.
//
// Denne fil beholder de AFLEDTE hjælpere (select-fragmenter, flattenAbilities,
// topAbilityKey), fordi de er frontend-specifikke og ikke hører til i registret.
export {
  ABILITY_CATEGORIES, ABILITY_KEYS, ABILITY_SHORT, ABILITY_ICONS, ABILITY_I18N_KEYS,
} from "./generated/abilityRegistry.js";

import { ABILITY_KEYS, ABILITY_SHORT } from "./generated/abilityRegistry.js";

// {key,label}-form til tabeller der itererer STATS = [{key,label}].
export const ABILITY_STATS = ABILITY_KEYS.map((key) => ({ key, label: ABILITY_SHORT[key] }));

// PostgREST select-fragment til at embedde de 15 evne-kolonner på en riders-query
// eller en nested rider:rider_id(...)-join.
export const ABILITY_SELECT = `rider_derived_abilities(${ABILITY_KEYS.join(", ")})`;

// Samme, men som !inner-join (kræves for server-side filter/order på evne-kolonner,
// så et evne-filter faktisk begrænser parent-rækkerne i stedet for kun det embedded).
export const ABILITY_SELECT_INNER = `rider_derived_abilities!inner(${ABILITY_KEYS.join(", ")})`;

// Navn på den embeddede relation (til .order(col, { referencedTable })-kald).
export const ABILITY_TABLE = "rider_derived_abilities";

// Løft de joinede rider_derived_abilities-felter op på selve rytter-objektet, så
// rider.climbing osv. virker direkte i render/sort/klient-filter (samme adgangs-
// mønster som de gamle rider.stat_*). Supabase-embed kan komme som array (to-many)
// eller objekt (to-one); vi håndterer begge. Bevarer også rider.abilities til de
// flader der allerede læser det (RiderStatsPage).
export function flattenAbilities(rider) {
  if (!rider) return rider;
  const rda = rider.rider_derived_abilities;
  const abil = Array.isArray(rda) ? rda[0] : rda;
  if (!abil) return rider;
  const out = { ...rider };
  for (const k of ABILITY_KEYS) out[k] = abil[k];
  out.abilities = { ...(rider.abilities || {}), ...abil };
  delete out.rider_derived_abilities;
  return out;
}

// Nøglen på rytterens højest-vurderede evne (#2000). Bruges som type-label-fallback
// på rytterprofilen når riders.primary_type mangler — erstatter den tidligere
// PCM-stat_*-afledning. `abilities` er en rider_derived_abilities-række (eller det
// fladtgjorte rider-objekt). Itererer ABILITY_KEYS i SSOT-rækkefølge, så uafgjorte
// maxima bryder mod den FØRSTE evne (samme tie-break som den gamle indexOf-logik).
// Returnerer null hvis ingen evne-række/numeriske værdier findes → kalderen falder
// tilbage til sin egen default-label.
export function topAbilityKey(abilities) {
  if (!abilities) return null;
  let bestKey = null;
  let bestVal = -Infinity;
  for (const key of ABILITY_KEYS) {
    const v = abilities[key];
    if (typeof v === "number" && v > bestVal) { bestVal = v; bestKey = key; }
  }
  return bestKey;
}
