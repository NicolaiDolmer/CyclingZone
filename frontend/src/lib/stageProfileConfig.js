// Delt stage-profil-config — ÉN kilde for hvordan et terræn (profile_type) vises
// som et lille terræn-badge + skematisk profil-silhuet på løbsresultater (#1484).
//
// ÆRLIGHED: race_stage_profiles bærer KUN en terræn-kategori (profile_type) +
// finale_type — IKKE distance/højdemeter (bevidst udskudt til den fulde race
// engine, #1021). Derfor er silhuetterne deterministiske KATEGORI-piktogrammer,
// ikke en målt højdeprofil. De lover ingen præcision de ikke har: samme
// profile_type giver altid samme form, uafhængigt af det konkrete løb.
//
// Ren .js uden JSX/React-imports, så `node --test` kan loade modulet direkte og
// RaceDetailPage kan importere PROFILE_TYPE_KEYS/profileShape uden bundling-magi.
// Forbrugeren tegner SVG'en (currentColor + cz-tokens); her bor kun geometrien.

// profile_type-værdier (CHECK-constraint i database/2026-06-06-race-stage-profiles.sql
// + PROFILE_TYPES i backend/lib/raceStageProfileGenerator.js). Holdes i sync med dem.
export const PROFILE_TYPE_KEYS = Object.freeze([
  "flat", "rolling", "hilly", "mountain", "high_mountain", "itt", "ttt", "cobbles", "classic",
]);

// finale_type-værdier (samme kilder). Bruges til labels, ikke til silhuet.
export const FINALE_TYPE_KEYS = Object.freeze([
  "bunch_sprint", "reduced_sprint", "punch", "long_climb", "descent", "solo_tt", "breakaway",
]);

// Silhuet-koordinatsystem: en 100×24-viewBox "sparkline". Hvert profil er en liste
// af y-værdier (0 = top/højt, 24 = bund/lavt) jævnt fordelt på x. Vi tegner en
// polyline gennem dem; lavt+jævnt = fladt, takket+spidst = bjerge. Tallene er
// håndvalgte kategori-former — ikke data — så de er stabile og læsbare ved 56px bredde.
const VIEW_W = 100;
const VIEW_H = 24;
const BASE = 21; // "havniveau"-linjen silhuetterne hviler på

// y-profiler pr. terræn. Værdier i [2, 22]; lavere tal = højere terræn.
const SHAPES = Object.freeze({
  // Lav, næsten flad linje med en hårfin ujævnhed (ikke en lineal).
  flat:          [21, 20, 21, 20, 21, 20, 21, 21],
  // Bløde, regelmæssige bølger.
  rolling:       [21, 17, 21, 17, 21, 17, 21, 18],
  // Hyppigere, skarpere kuperinger.
  hilly:         [21, 14, 20, 13, 21, 14, 20, 15],
  // Få markante bjergtoppe.
  mountain:      [21, 19, 9, 18, 7, 17, 19, 20],
  // Høje, spidse toppe der topper ud.
  high_mountain: [21, 16, 6, 14, 3, 12, 17, 20],
  // Enkeltstart: ren, flad streg (én rytter mod uret) med en lille startrampe.
  itt:           [21, 21, 20, 21, 20, 21, 20, 21],
  // Holdstart: samme rene streg som ITT.
  ttt:           [21, 21, 20, 21, 20, 21, 20, 21],
  // Brosten: flad rute med tæt, lav rumlen (chikaneret, ikke bakket).
  cobbles:       [21, 20, 21, 19, 21, 20, 21, 20],
  // Klassiker: blandet rullende + et par korte stik.
  classic:       [21, 18, 13, 19, 14, 18, 20, 17],
});

/**
 * Deterministisk silhuet-geometri for et terræn.
 * @param {string} profileType  én af PROFILE_TYPE_KEYS (ukendt → "flat"-fallback)
 * @returns {{ points: string, baseY: number, width: number, height: number }}
 *   `points` er klar til <polyline points={...}>; `baseY` er havniveau-linjen.
 */
export function profileShape(profileType) {
  const ys = SHAPES[profileType] || SHAPES.flat;
  const n = ys.length;
  const step = VIEW_W / (n - 1);
  const points = ys
    .map((y, i) => `${+(i * step).toFixed(2)},${y}`)
    .join(" ");
  return { points, baseY: BASE, width: VIEW_W, height: VIEW_H };
}

/**
 * i18n-nøgle til terræn-labelen. RaceDetailPage slår op i races-namespacet:
 *   t(`detail.profileType.${key}`)  /  t(`detail.finaleType.${key}`)
 * Ukendt profile_type → null, så forbrugeren kan skjule badget i stedet for at
 * vise en rå/manglende nøgle (graceful degrade — ingen falsk visning).
 */
export function profileLabelKey(profileType) {
  return PROFILE_TYPE_KEYS.includes(profileType) ? `profileType.${profileType}` : null;
}

export function finaleLabelKey(finaleType) {
  return finaleType && FINALE_TYPE_KEYS.includes(finaleType) ? `finaleType.${finaleType}` : null;
}
