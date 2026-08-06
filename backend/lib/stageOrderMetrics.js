// backend/lib/stageOrderMetrics.js
// #3326 + #3371: måle-laget for etaperækkefølge og arketype-variation.
//
// HVORFOR EN EGEN FIL: begge issues har accept-kriterier formuleret som TAL på en hel
// sæson ("<60 % af etapeløb slutter på bjerg", ">10 % har bjerg i første halvdel",
// "ingen profil-sekvens delt af >8 løb"). De tal blev oprindeligt målt med ad hoc-SQL
// mod PERSISTEREDE rækker — men persisterede etaper regenereres aldrig (#2411-noten i
// raceStageProfileGenerator.js), så en SQL-måling beskriver den generator der kørte da
// rækkerne blev skrevet, ikke den vi har nu. Derfor er målingen her en REN funktion over
// GENEREREDE etaper, præcis som raceRouteRealismMetrics.js: samme input som skrive-stien
// producerer, så tallene er reproducerbare og kan asserteres i test.
//
// Ren — ingen DB/RNG.

const MOUNTAIN = new Set(["mountain", "high_mountain"]);
const FLAT_FAMILY = new Set(["flat", "rolling"]);

// #3326's accept-kriterier, som data (samme princip som TIER_TARGETS).
export const STAGE_ORDER_TARGETS = Object.freeze({
  // "<60 % af etapeløb slutter på bjerg" — den hårde crescendo gav 84,1 %.
  mountain_finish_max_pct: 60,
  // ">10 % har bjerg-etape i første halvdel" — den hårde crescendo gav reelt 0 tidlige bjerge.
  mountain_first_half_min_pct: 10,
  // "ingen enkelt profil-sekvens deles af >8 løb i samme sæson" — 24 løb delte
  // flat>mountain>high_mountain>high_mountain før #3326.
  max_shared_sequence: 8,
});

/**
 * Mål etaperækkefølge over et sæt genererede ETAPELØB (endagsløb ignoreres — de har
 * ingen rækkefølge). Kalderen filtrerer ikke selv: funktionen tager hele løbslisten.
 *
 * @param {Array<{race_type?:string, terrain_archetype?:string|null, name?:string,
 *                stages:Array<{profile_type:string}>}>} races
 */
export function computeStageOrderStats(races = []) {
  const stageRaces = races.filter((r) => r?.race_type === "stage_race" && Array.isArray(r.stages) && r.stages.length >= 2);
  const n = stageRaces.length;

  const sequenceCounts = new Map();
  const archetypeCounts = {};
  let mountainOpen = 0, flatOpen = 0, ittOpen = 0;
  let mountainFinish = 0, flatFinish = 0, ittFinish = 0;
  let mountainFirstHalf = 0;

  for (const r of stageRaces) {
    const types = r.stages.map((s) => s.profile_type);
    const first = types[0];
    const last = types[types.length - 1];

    if (MOUNTAIN.has(first)) mountainOpen++;
    else if (FLAT_FAMILY.has(first)) flatOpen++;
    else if (first === "itt") ittOpen++;

    if (MOUNTAIN.has(last)) mountainFinish++;
    else if (FLAT_FAMILY.has(last)) flatFinish++;
    else if (last === "itt") ittFinish++;

    // "Første halvdel" = ceil(n/2) etaper. For et 3-etapers løb er det etape 1-2:
    // en bjergetape på etape 2 af 3 ER den tidlige bjergdag spilleren efterspurgte
    // ("we did the mountain day 2, now there's 3 days to get the time back").
    const half = Math.ceil(types.length / 2);
    if (types.slice(0, half).some((t) => MOUNTAIN.has(t))) mountainFirstHalf++;

    const key = types.join(">");
    sequenceCounts.set(key, (sequenceCounts.get(key) ?? 0) + 1);

    const arch = r.terrain_archetype ?? "(ingen arketype)";
    archetypeCounts[arch] = (archetypeCounts[arch] ?? 0) + 1;
  }

  const sorted = [...sequenceCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const pct = (x) => (n > 0 ? (100 * x) / n : 0);

  return {
    stageRaces: n,
    distinctSequences: sequenceCounts.size,
    topSequences: sorted.slice(0, 8).map(([sequence, count]) => ({ sequence, count })),
    maxSharedSequence: sorted.length ? sorted[0][1] : 0,
    // Sæsonens største entydige "skabelon" — #3371's kerneklage.
    topSequenceSharePct: sorted.length ? pct(sorted[0][1]) : 0,
    mountainOpenPct: pct(mountainOpen), flatOpenPct: pct(flatOpen), ittOpenPct: pct(ittOpen),
    mountainFinishPct: pct(mountainFinish), flatFinishPct: pct(flatFinish), ittFinishPct: pct(ittFinish),
    mountainFirstHalfPct: pct(mountainFirstHalf),
    archetypeCounts,
    distinctArchetypes: Object.keys(archetypeCounts).length,
  };
}

/**
 * Sammenlign mod #3326's accept-kriterier. Samme violation-string-form som
 * detectCoverageViolations / detectCompositionViolations.
 */
export function detectStageOrderViolations({ stats, label = "sæson", targets = STAGE_ORDER_TARGETS } = {}) {
  const violations = [];
  if (!stats) return violations;
  // 0 etapeløb er fravær af evidens, ikke et opfyldt krav — meld det, gæt ikke grønt (#2854).
  if (stats.stageRaces === 0) return [`${label}: 0 etapeløb at måle rækkefølge på — kriterierne kan ikke vurderes (#3326)`];

  if (stats.mountainFinishPct > targets.mountain_finish_max_pct) {
    violations.push(`${label}: ${stats.mountainFinishPct.toFixed(1)} % af etapeløb slutter på bjerg, over maks ${targets.mountain_finish_max_pct} % (#3326)`);
  }
  if (stats.mountainFirstHalfPct < targets.mountain_first_half_min_pct) {
    violations.push(`${label}: kun ${stats.mountainFirstHalfPct.toFixed(1)} % af etapeløb har bjerg i første halvdel, under minimum ${targets.mountain_first_half_min_pct} % (#3326)`);
  }
  if (stats.maxSharedSequence > targets.max_shared_sequence) {
    violations.push(`${label}: én profil-sekvens deles af ${stats.maxSharedSequence} løb, over maks ${targets.max_shared_sequence} (#3326)`);
  }
  return violations;
}
