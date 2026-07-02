// Delt evne-config — ÉN kilde til sandhed for de 15 viste CZ-evner (#1122/#1529).
// Erstatter de tidligere pr-side STATS/LISTING_STATS PCM-konstanter. PCM-stats
// (riders.stat_*) bliver i datamodellen som derive-kilde (backend/lib/abilityDerivation.js);
// kun VISNINGEN bruger disse evner. Ren .js uden JSX-imports, så `node --test` kan loade.
//
// Rækkefølge = ejer-bekræftet kategori-gruppering (Physical → Mental → Technical),
// jf. EPIC #2000 slice 1. `prolog` er udeladt (merget i time_trial per
// abilityDerivation). Korte labels = kolonne-overskrifter (oversættes ikke, jf.
// #487); fulde navne via i18n rider.json racePreview.derived.<key>.

// Kategori-gruppering — ÉN kilde til sandhed for grupperet visning (RiderStatsPage).
// Rækkefølgen af grupperne OG nøglerne i hver gruppe er ejer-bekræftet (#2000).
export const ABILITY_CATEGORIES = [
  {
    key: "physical",
    keys: [
      "climbing", "tempo", "punch", "sprint", "acceleration",
      "flat", "time_trial", "endurance", "durability", "recovery",
    ],
  },
  {
    key: "mental",
    keys: ["aggression", "tactics"],
  },
  {
    key: "technical",
    keys: ["descending", "cobblestone", "positioning"],
  },
];

// Flad liste af alle 15 evne-keys i kategori-rækkefølge. Afledt af
// ABILITY_CATEGORIES så de to aldrig kan divergere.
export const ABILITY_KEYS = ABILITY_CATEGORIES.flatMap((c) => c.keys);

// Korte, distinkte kolonne-labels (2-3 tegn) — som PCM-labels (FL/BJ/...) var.
export const ABILITY_SHORT = {
  climbing: "CLM", time_trial: "TT", flat: "FLT", tempo: "TMP",
  sprint: "SPR", acceleration: "ACC", punch: "PCH", endurance: "END",
  recovery: "REC", durability: "DUR", descending: "DSC", cobblestone: "COB",
  positioning: "POS", aggression: "AGR", tactics: "TAC",
};

// Glyf-ikoner pr. evne — genbruger samme visuelle sprog som de traditionelle
// skills. Vises foran labelen på RiderStatsPage's grupperede evne-visning.
export const ABILITY_ICONS = {
  climbing: "▲", tempo: "◈", punch: "✦", sprint: "↯", acceleration: "▷",
  flat: "▬", time_trial: "◴", endurance: "◎", durability: "⬣", recovery: "↺",
  aggression: "➹", tactics: "⌖", descending: "▽", cobblestone: "⬡", positioning: "⊹",
};

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
