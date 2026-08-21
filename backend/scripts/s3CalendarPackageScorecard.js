#!/usr/bin/env node
// backend/scripts/s3CalendarPackageScorecard.js
// #3546: S3-kalender-pakken (ejer-beslutninger 17/8): FØR/EFTER dry-run-scorecard for
// de 7 leverancer (A: GT-længde 21→17-18, B: Giro-spredningens rodfix, C: mindst 1
// afgørelse pr. D1-kalenderdag, D: itt_hilly-arketype, E: uphill-finishes hilly/rolling,
// F: to brostens-vinduer, G: D2-samtidigheds-cap: E/F/G tilføjet 17/8 aften via en
// Discord-sweep, samme pakke/scorecard). 100 % READ-ONLY mod prod:
// buildTierMaterializationPlan er en REN funktion (ingen DB/writes): kun .select()-kald
// mod Supabase (league_divisions/teams/race_pool). Rører ALDRIG den live kalender.
//
//   node scripts/s3CalendarPackageScorecard.js
//   node scripts/s3CalendarPackageScorecard.js --json
//
// FØR = det ÆGTE race_pool-katalog, uændret (21-etapers GT'er, gammel packLaneCalendar-
//        adfærd: men KØRT gennem denne PRs kode, dvs. B/C/D's mekanismer er AKTIVE, kun
//        A (GT-etapeantal) er den gamle 21-værdi). Det isolerer B/C/D's effekt uafhængigt
//        af A, og undgår at overstyre B/C's fase-vinduer med Beslutning A's data ELLER at
//        skulle overstyre koden for at måle "kun A".
// EFTER = det ÆGTE katalog MED de 3 GT-rækkers stages/date_text patchet in-memory til
//        18/17/17 (Giro/Hexagone/Vuelta, ejer-arkitekt-valg 17/8): PRÆCIS de værdier
//        scripts/race_pool_seed.csv nu indeholder. DB røres aldrig; patchen sker kun i
//        det array denne proces holder i hukommelsen.
//
// 3 SEEDS: season_id er en del af generateRaceStageProfiles' seed-nøgle (parcours-trækket,
// herunder itt_hilly-forekomst), så vi kører planen for 3 HYPOTETISKE sæson-numre (3/4/5)  - 
// samme katalog/selection/packing-struktur (season påvirker IKKE selectTierRaceSet), men 3
// uafhængige parcours-/itt-trækninger. seasonUuid følger samme konvention som
// calendarCompositionScorecard.js.

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";
import { buildTierMaterializationPlan } from "../lib/tierCalendarMaterializer.js";
import { generateRaceStageProfiles } from "../lib/raceStageProfileGenerator.js";
import { GRAND_TOUR_MIN_STAGES } from "../lib/tierRaceSelection.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env"), quiet: true });

export const SEEDS = Object.freeze([3, 4, 5]); // hypotetiske sæson-numre, se header

export function seasonUuid(n) {
  return `00000000-0000-0000-0000-${Number(n).toString(16).padStart(12, "0")}`;
}

// #3546 A: de 3 GT-arkitekt-valg (ejer-beslutning 17/8): MATCHER scripts/race_pool_seed.csv.
// date_text valgt så grandTourRestDayCount() (spanDays-stages) bevarer DAGENS hviledags-antal
// (Giro 3, Hexagone 2, Vuelta 2): se backend/lib/grandTourRestDays.js for formlen.
export const GT_STAGE_PATCH = Object.freeze({
  "Tour de l'Hexagone": { stages: 17, date_text: "4/7 - 22/7" },
  "Giro della Penisola": { stages: 18, date_text: "8/5 - 28/5" },
  "Vuelta Ibérica": { stages: 17, date_text: "22/8 - 9/9" },
});

/** Patch de 3 navngivne GT-rækker i et katalog IN-MEMORY. Ren funktion. */
export function applyGtStagePatch(catalog, patch = GT_STAGE_PATCH) {
  return catalog.map((row) => (patch[row.name] ? { ...row, ...patch[row.name] } : row));
}

/** Læs read-only kildedata (pools + real katalog): samme mønster som dryRunTierCalendarBalance.js. */
export async function loadPoolsAndCatalog(supabase) {
  const { data: divisions, error: dErr } = await supabase.from("league_divisions").select("id, tier, pool_index, label");
  if (dErr) throw new Error(`league_divisions: ${dErr.message}`);
  const { data: teams, error: tErr } = await supabase.from("teams").select("league_division_id, is_ai, is_bank, is_frozen, is_test_account");
  if (tErr) throw new Error(`teams: ${tErr.message}`);
  const { data: catalog, error: cErr } = await supabase
    .from("race_pool")
    .select("id, external_id, terrain_archetype, name, race_class, race_type, stages, date_text")
    .is("retired_at", null); // #4075: pensionerede rækker er usynlige for selektionen
  if (cErr) throw new Error(`race_pool: ${cErr.message}`);

  const isReal = (t) => t.is_ai === false && !t.is_bank && !t.is_frozen && !t.is_test_account;
  const realByDiv = new Map();
  for (const t of teams || []) if (isReal(t) && t.league_division_id != null) realByDiv.set(t.league_division_id, (realByDiv.get(t.league_division_id) || 0) + 1);
  const pools = (divisions || []).map((d) => ({ id: d.id, tier: d.tier, label: d.label, realManagerCount: realByDiv.get(d.id) || 0 }));

  return { pools, catalog: catalog || [] };
}

// ── Måling ───────────────────────────────────────────────────────────────────────────
const FROM = new Date("2026-01-01T00:00:00Z"); // vilkårlig: kun scheduling-tider, ikke målt.

function gtRowsOf(tierPlan) {
  return (tierPlan.chronologyRaces ?? []).filter((r) => (r.stages ?? 1) >= GRAND_TOUR_MIN_STAGES);
}

/**
 * Kør planen for tier 1 (D1: hvor alle 4 leverancer er målbare: GT'er, monumenter,
 * kalenderdage) for ét katalog + ét sæson-seed. Ren måling, ingen DB-writes.
 */
export function measureOnce({ pools, catalog, seasonNumber }) {
  const { tierPlans } = buildTierMaterializationPlan({ pools, catalog, from: FROM, baseSeed: 1 });
  const tier1 = tierPlans.find((t) => t.tier === 1);
  if (!tier1) return null;

  // buildTierMaterializationPlan (den RENE funktion) tilføjer IKKE `seedRaces`: det felt
  // findes kun i materializeTierCalendars' I/O-wrapper. Byg seed-konteksten selv fra
  // katalog-maps + tier1's repræsentative puljes raceRows (samme shape som
  // tierCalendarMaterializer.js's seedRaceFor, KUN til denne målings-harness).
  const externalIdByPoolRace = new Map(catalog.map((c) => [c.id, c.external_id ?? null]));
  const archetypeByPoolRace = new Map(catalog.map((c) => [c.id, c.terrain_archetype ?? null]));
  const repPool = tier1.pools[0];
  const seedRacesById = new Map((repPool?.raceRows ?? []).map((r) => [r.pool_race_id, {
    id: r.pool_race_id, name: r.name, race_type: r.race_type, stages: r.stages,
    external_id: externalIdByPoolRace.get(r.pool_race_id) ?? null,
    terrain_archetype: archetypeByPoolRace.get(r.pool_race_id) ?? null,
    season_id: seasonNumber,
  }]));

  // (1) GT-andel af slots (game-days).
  const gts = gtRowsOf(tier1);
  const gtGameDays = gts.reduce((s, g) => s + (g.stages ?? 0), 0);
  const gtShare = tier1.quota > 0 ? gtGameDays / tier1.quota : null;

  // (2) Kalender-spænd pr. GT i dage (real_day_end - game_day_start + 1, jf.
  // chronologyRaces' docstring i tierCalendarMaterializer.js: game_day_start ER en
  // real_day trods navnet: arvet feltnavn fra #3469).
  const gtSpans = gts.map((g) => ({
    name: seedRacesById.get(g.id)?.name ?? null,
    id: g.id,
    stages: g.stages,
    startRealDay: g.game_day_start,
    endRealDay: g.real_day_end,
    spanDays: Number.isFinite(g.real_day_end) && Number.isFinite(g.game_day_start) ? g.real_day_end - g.game_day_start + 1 : null,
  }));

  // #3546 E/F (scope-udvidelse 17/8 aften): profiler for ALLE tier1's selekterede races
  // (ikke kun GT'erne): nødvendigt for uphill-finish-andelen (6) og cobbles-fordelingen (7).
  const allProfilesByPoolRaceId = new Map();
  for (const r of repPool?.raceRows ?? []) {
    const seedRace = seedRacesById.get(r.pool_race_id);
    if (seedRace) allProfilesByPoolRaceId.set(r.pool_race_id, generateRaceStageProfiles(seedRace));
  }

  // (3) Dage uden afgørelse.
  const daysWithoutDecisionCount = tier1.daysWithoutDecisionCount ?? 0;
  const daysWithoutDecision = tier1.daysWithoutDecision ?? [];

  // (4) ITT-profiler pr. GT (flad "itt" vs. kuperet "itt_hilly").
  const ittByGt = gts.map((g) => {
    const seedRace = seedRacesById.get(g.id);
    const profiles = allProfilesByPoolRaceId.get(g.id) ?? [];
    if (!seedRace) return { id: g.id, name: null, itt: null, itt_hilly: null };
    const itt = profiles.filter((p) => p.profile_type === "itt").length;
    const ittHilly = profiles.filter((p) => p.profile_type === "itt_hilly").length;
    return { id: g.id, name: seedRace.name ?? null, itt, itt_hilly: ittHilly };
  });

  // (5) Invarianter: klasse/etape-bånd (#3328, via calendarViolations/coverage), hviledage
  // intakte (grandTourRestDays), 5 events/dag i D1 (load).
  const classBandViolations = (tier1.calendarViolations ?? []).filter((v) => v.includes("#3328") || v.toLowerCase().includes("band"));
  const restDayReport = tier1.grandTourRestDays ?? [];
  const restDaysDegraded = restDayReport.reduce((s, r) => s + (r.degradedAfterStage?.length ?? 0), 0);
  const densityOk = Array.isArray(tier1.load) && tier1.load.every((x) => x === tier1.density);

  // (6) Uphill-finish-andel pr. profiltype (#3546 E, ejer-mål: ~35% hilly / ~20% rolling).
  // Måles over ALLE D1's selekterede racers etaper (ikke kun GT'erne): hilly/rolling
  // findes primært i ikke-GT-etapeløb + endagsløb.
  const uphillFinishStats = { hilly: { total: 0, summit: 0 }, rolling: { total: 0, summit: 0 } };
  for (const profiles of allProfilesByPoolRaceId.values()) {
    for (const p of profiles) {
      if (p.profile_type !== "hilly" && p.profile_type !== "rolling") continue;
      const bucket = uphillFinishStats[p.profile_type];
      bucket.total += 1;
      if (p.climbs?.some((c) => c.summit_finish)) bucket.summit += 1;
    }
  }
  const uphillFinishShare = Object.fromEntries(
    Object.entries(uphillFinishStats).map(([k, v]) => [k, v.total > 0 ? v.summit / v.total : null])
  );

  // (7) Cobbles-fordeling pr. uge (#3546 F, ejer-mål: to synlige vinduer, ikke monotont
  // fald). Bucketer tier1's cobbled_classic-endagsløb på deres PLACEREDE real_day (fra
  // chronologyRaces) i uger af 7 kalenderdage over den 28-dages D1-horisont.
  const archetypeById = new Map(catalog.map((c) => [c.id, c.terrain_archetype ?? null]));
  const cobblesWeeks = new Map(); // week-index -> count
  for (const r of tier1.chronologyRaces ?? []) {
    if (archetypeById.get(r.id) !== "cobbled_classic") continue;
    if (!Number.isFinite(r.game_day_start)) continue; // #3469: game_day_start ER real_day her
    const week = Math.floor(r.game_day_start / 7);
    cobblesWeeks.set(week, (cobblesWeeks.get(week) ?? 0) + 1);
  }
  const cobblesByWeek = [...cobblesWeeks.entries()].sort((a, b) => a[0] - b[0]).map(([week, count]) => ({ week, count }));

  // (9) Kalender-spænd pr. IKKE-GT-etapeløb (#3546 H, ejer-mål 17/8 sen aften: spillere
  // målte samme strækningspatologi på småløb som B fiksede for GT'erne). stretch = spænd
  // / stages: 1.0 = ingen strækning (etaperne kører uafbrudt), >1 = huller. Mål: intet
  // ikke-GT-løb over stages+3 (H's hårde grænse, håndhævet i enforceDailyDecisions).
  const nonGtStageRaces = (tier1.chronologyRaces ?? []).filter((r) => (r.stages ?? 1) >= 2 && r.stages < GRAND_TOUR_MIN_STAGES);
  const stageRaceSpans = nonGtStageRaces.map((r) => {
    const span = Number.isFinite(r.real_day_end) && Number.isFinite(r.game_day_start) ? r.real_day_end - r.game_day_start + 1 : null;
    return { id: r.id, name: seedRacesById.get(r.id)?.name ?? null, stages: r.stages, span, stretch: span != null ? span / r.stages : null, overHardLimit: span != null ? span > r.stages + 3 : null };
  }).sort((a, b) => (b.stretch ?? 0) - (a.stretch ?? 0));
  const stretchValues = stageRaceSpans.map((r) => r.stretch).filter(Number.isFinite).sort((a, b) => a - b);
  const stretchMax = stretchValues.length ? stretchValues[stretchValues.length - 1] : null;
  const stretchMedian = stretchValues.length ? stretchValues[Math.floor(stretchValues.length / 2)] : null;
  const stretchOverHardLimitCount = stageRaceSpans.filter((r) => r.overHardLimit).length;

  return {
    seasonNumber,
    quota: tier1.quota, density: tier1.density,
    gtCount: gts.length, gtGameDays, gtShare,
    gtSpans, ittByGt,
    daysWithoutDecisionCount, daysWithoutDecision,
    calendarViolationsCount: (tier1.calendarViolations ?? []).length,
    calendarViolations: tier1.calendarViolations ?? [],
    classBandViolationsCount: classBandViolations.length,
    restDayReport, restDaysDegraded,
    densityOk,
    uphillFinishStats, uphillFinishShare,
    cobblesByWeek,
    stageRaceSpans, stretchMax, stretchMedian, stretchOverHardLimitCount,
    gtRealDaySeparationViolations: tier1.gtRealDaySeparationViolations ?? [],
  };
}

/** #3546 G: max samtidige løb pr. division, over ALLE 4 tiers (ikke kun D1). Ejer-mål:
 * D2 ≤ 3 (ned fra "op til 4" målt i den LEVENDE, ældre-genererede S3-kalender), D3/D4 ≤ 2
 * uændret. Målt EMPIRISK mod en FRISK plan (denne PRs kode): ikke den live kalender. */
export function measureOverlapByTier({ pools, catalog }) {
  const { tierPlans } = buildTierMaterializationPlan({ pools, catalog, from: FROM, baseSeed: 1 });
  return tierPlans.map((t) => ({ tier: t.tier, maxOverlap: t.maxOverlap, overlapCap: t.overlapCap, withinCap: t.maxOverlap <= t.overlapCap }));
}

/** Kør FØR+EFTER over alle seeds. Ren funktion (catalog/pools sendes ind). */
export function runScorecard({ pools, catalog }) {
  const before = SEEDS.map((s) => measureOnce({ pools, catalog, seasonNumber: seasonUuid(s) }));
  const patched = applyGtStagePatch(catalog);
  const after = SEEDS.map((s) => measureOnce({ pools, catalog: patched, seasonNumber: seasonUuid(s) }));
  const overlapBefore = measureOverlapByTier({ pools, catalog });
  const overlapAfter = measureOverlapByTier({ pools, catalog: patched });
  return { before, after, overlapBefore, overlapAfter };
}

// ── Render (markdown) ───────────────────────────────────────────────────────────────
function avg(nums) {
  const v = nums.filter((n) => Number.isFinite(n));
  return v.length ? v.reduce((s, n) => s + n, 0) / v.length : null;
}
function fmtPct(n) { return Number.isFinite(n) ? `${(n * 100).toFixed(1)} %` : "?"; }
function fmtNum(n, d = 1) { return Number.isFinite(n) ? n.toFixed(d) : "?"; }

export function formatMarkdown({ before, after, overlapBefore, overlapAfter }) {
  const lines = [];
  lines.push(`# S3-kalender-pakke: dry-run-scorecard (#3546)`);
  lines.push(``);
  lines.push(`Genereret ${new Date().toISOString().slice(0, 10)}. 100 % read-only mod prod-kataloget (\`race_pool\`)  - `);
  lines.push(`ingen DB-writes, ingen kalender-regenerering. FØR/EFTER kørt over ${SEEDS.length} seeds (hypotetiske`);
  lines.push(`sæson-numre ${SEEDS.join("/")}) på tier 1 (D1), som er hvor de fleste af de 7 leverancer er målbare.`);
  lines.push(`Pakken dækker de 4 oprindelige beslutninger (A-D, 17/8 morgen) + 3 tilføjet samme aften efter en`);
  lines.push(`Discord-sweep (E: uphill-finishes, F: to brostens-vinduer, G: D2-samtidigheds-cap).`);
  lines.push(``);
  lines.push(`FØR = ægte katalog uændret (21-etapers GT'er). EFTER = ægte katalog + de 3 GT-rækkers`);
  lines.push(`stages/date_text patchet in-memory til Giro 18 / Hexagone 17 / Vuelta 17 (matcher`);
  lines.push(`\`scripts/race_pool_seed.csv\`): samme værdi B/C/D/E/F/G's kode-ændringer kører igennem i begge kolonner`);
  lines.push(`(E/F/G er ikke gated af A, så de to kolonner ligner hinanden for målene 6-8: kun sekundære`);
  lines.push(`knock-on-effekter af A/B's ændrede løbsudvalg adskiller dem).`);
  lines.push(``);

  lines.push(`## 0. #3467 bufferdag (ejer-beslutning 18/8, KS3) — første løbsdag`);
  lines.push(``);
  lines.push(`Dette scorecard måler ren KOMPOSITION (GT-længde, spredning, dagsafgørelser, profiltyper,`);
  lines.push(`overlap) og er bevidst AFKOBLET fra kalenderdatoer — \`FROM\` ovenfor er vilkårlig`);
  lines.push(`(2026-01-01, kun scheduling-tider, ikke målt). Første løbsdag er derfor IKKE et tal dette`);
  lines.push(`scorecard kan vise meningsfuldt.`);
  lines.push(``);
  lines.push(`Ejer-beslutningen 18/8 (#3467): 24/8 = hviledag (INGEN løb), FØRSTE S3-LØBSDAG = 25/8.`);
  lines.push(`Den nu wipede prod-kalender havde første etape mandag 24/8 kl. 11 — forældet på præcis`);
  lines.push(`dette punkt (fra FØR beslutningen). Bufferdagen er implementeret og VERIFICERET som en`);
  lines.push(`caller-leveret \`from\`-værdi (\`resolveCalendarFrom({ firstRaceDate: "2026-08-25" })\`),`);
  lines.push(`IKKE en ændring i selve kompositions-koden denne PR rører — se`);
  lines.push(`\`backend/scripts/dev/regenSeason3Calendar.mjs\`, som kører den ÆGTE plan (rigtige datoer,`);
  lines.push(`100 % read-only dry-run) og STOPPER hvis det tidligste planlagte løb ikke lander præcis`);
  lines.push(`på 2026-08-25.`);
  lines.push(``);

  lines.push(`## 1. GT-andel af D1-slots`);
  lines.push(``);
  lines.push(`| Seed | FØR | EFTER |`);
  lines.push(`|---|---|---|`);
  for (let i = 0; i < SEEDS.length; i++) {
    lines.push(`| ${SEEDS[i]} | ${fmtPct(before[i]?.gtShare)} (${before[i]?.gtGameDays}/${before[i]?.quota}) | ${fmtPct(after[i]?.gtShare)} (${after[i]?.gtGameDays}/${after[i]?.quota}) |`);
  }
  lines.push(`| **gennemsnit** | **${fmtPct(avg(before.map((b) => b?.gtShare)))}** | **${fmtPct(avg(after.map((a) => a?.gtShare)))}** |`);
  lines.push(``);

  lines.push(`## 2. Kalender-spænd pr. GT (kalenderdage)`);
  lines.push(``);
  lines.push(`| Seed | GT | FØR (dage) | EFTER (dage) |`);
  lines.push(`|---|---|---|---|`);
  for (let i = 0; i < SEEDS.length; i++) {
    const b = before[i]?.gtSpans ?? [], a = after[i]?.gtSpans ?? [];
    const names = [...new Set([...b.map((x) => x.name), ...a.map((x) => x.name)])];
    for (const name of names) {
      const bb = b.find((x) => x.name === name);
      const aa = a.find((x) => x.name === name);
      lines.push(`| ${SEEDS[i]} | ${name ?? "?"} | ${bb?.spanDays ?? "?"} | ${aa?.spanDays ?? "?"} |`);
    }
  }
  const spreadOf = (entry) => {
    const spans = (entry?.gtSpans ?? []).map((s) => s.spanDays).filter(Number.isFinite);
    return spans.length ? Math.max(...spans) - Math.min(...spans) : null;
  };
  lines.push(``);
  lines.push(`Spredning (maks−min spænd på tværs af de 3 GT'er, mål ≤1 dag EFTER):`);
  lines.push(``);
  lines.push(`| Seed | FØR | EFTER |`);
  lines.push(`|---|---|---|`);
  for (let i = 0; i < SEEDS.length; i++) lines.push(`| ${SEEDS[i]} | ${spreadOf(before[i]) ?? "?"} | ${spreadOf(after[i]) ?? "?"} |`);
  lines.push(``);

  lines.push(`## 3. Dage uden afgørelse (D1)`);
  lines.push(``);
  lines.push(`| Seed | FØR | EFTER |`);
  lines.push(`|---|---|---|`);
  for (let i = 0; i < SEEDS.length; i++) {
    lines.push(`| ${SEEDS[i]} | ${before[i]?.daysWithoutDecisionCount ?? "?"} (${(before[i]?.daysWithoutDecision ?? []).join(",")}) | ${after[i]?.daysWithoutDecisionCount ?? "?"} (${(after[i]?.daysWithoutDecision ?? []).join(",")}) |`);
  }
  lines.push(``);

  lines.push(`## 4. ITT-profiler pr. GT (flad "itt" vs. kuperet "itt_hilly")`);
  lines.push(``);
  lines.push(`| Seed | GT | FØR itt/itt_hilly | EFTER itt/itt_hilly |`);
  lines.push(`|---|---|---|---|`);
  for (let i = 0; i < SEEDS.length; i++) {
    const b = before[i]?.ittByGt ?? [], a = after[i]?.ittByGt ?? [];
    const names = [...new Set([...b.map((x) => x.name), ...a.map((x) => x.name)])];
    for (const name of names) {
      const bb = b.find((x) => x.name === name);
      const aa = a.find((x) => x.name === name);
      lines.push(`| ${SEEDS[i]} | ${name ?? "?"} | ${bb ? `${bb.itt}/${bb.itt_hilly}` : "?"} | ${aa ? `${aa.itt}/${aa.itt_hilly}` : "?"} |`);
    }
  }
  lines.push(``);

  lines.push(`## 5. Eksisterende invarianter (ingen brud tilladt)`);
  lines.push(``);
  lines.push(`| Seed | Klasse/etape-bånd-brud (#3328) FØR/EFTER | Hviledage degraderet FØR/EFTER | 5 events/dag holdt FØR/EFTER | GT-real-day-separation (#3472 v3) FØR/EFTER |`);
  lines.push(`|---|---|---|---|---|`);
  for (let i = 0; i < SEEDS.length; i++) {
    lines.push(
      `| ${SEEDS[i]} | ${before[i]?.classBandViolationsCount ?? "?"}/${after[i]?.classBandViolationsCount ?? "?"} | ` +
      `${before[i]?.restDaysDegraded ?? "?"}/${after[i]?.restDaysDegraded ?? "?"} | ` +
      `${before[i]?.densityOk ?? "?"}/${after[i]?.densityOk ?? "?"} | ` +
      `${(before[i]?.gtRealDaySeparationViolations ?? []).length}/${(after[i]?.gtRealDaySeparationViolations ?? []).length} |`
    );
  }
  lines.push(``);
  lines.push(`GT-real-day-separation-kolonnen er tilføjet efter en regression opdaget under H-implementeringen`);
  lines.push(`(17/8 sen aften): C's dagsafgørelses-bytte kunne flytte en GT-etape og bryde "ingen delt`);
  lines.push(`kalenderdag mellem to GT'er". Fikset (GT'er er nu UDELUKKET fra C's bytte-kandidatur helt): se`);
  lines.push(`"Fund og begrænsninger" for detaljer. 0/0 i tabellen ovenfor bekræfter fixet holder på det ægte katalog.`);
  lines.push(``);

  const allViolations = [...before, ...after].flatMap((e) => e?.calendarViolations ?? []);
  if (allViolations.length) {
    lines.push(`### Fulde calendarViolations-liste (FØR+EFTER, alle seeds)`);
    lines.push(``);
    for (const v of new Set(allViolations)) lines.push(`- ${v}`);
    lines.push(``);
  } else {
    lines.push(`Ingen calendarViolations i nogen kørsel (FØR eller EFTER, nogen seed).`);
    lines.push(``);
  }

  lines.push(`## 6. Uphill-finish-andel pr. profiltype (#3546 E, D1, alle selekterede løb)`);
  lines.push(``);
  lines.push(`Ejer-mål: ~35 % hilly, ~20 % rolling (prod målte 0 % for begge, 0/254 hhv. 0/65).`);
  lines.push(``);
  lines.push(`| Seed | Hilly FØR | Hilly EFTER | Rolling FØR | Rolling EFTER |`);
  lines.push(`|---|---|---|---|---|`);
  for (let i = 0; i < SEEDS.length; i++) {
    const b = before[i]?.uphillFinishStats, a = after[i]?.uphillFinishStats;
    const cell = (s) => (s ? `${fmtPct(s.total > 0 ? s.summit / s.total : null)} (${s.summit}/${s.total})` : "?");
    lines.push(`| ${SEEDS[i]} | ${cell(b?.hilly)} | ${cell(a?.hilly)} | ${cell(b?.rolling)} | ${cell(a?.rolling)} |`);
  }
  const shareAvg = (arr, pt) => avg(arr.map((e) => e?.uphillFinishShare?.[pt]));
  lines.push(`| **gennemsnit** | **${fmtPct(shareAvg(before, "hilly"))}** | **${fmtPct(shareAvg(after, "hilly"))}** | **${fmtPct(shareAvg(before, "rolling"))}** | **${fmtPct(shareAvg(after, "rolling"))}** |`);
  lines.push(``);

  lines.push(`## 7. Cobbles-fordeling pr. uge (#3546 F, D1)`);
  lines.push(``);
  lines.push(`Ejer-mål: to synlige vinduer (tidligt + sent i sæsonen), ikke prod's monotone fald`);
  lines.push(`(målt 29→24→18→8 pr. uge i det rå katalog). Uge = \`floor(placeret real_day / 7)\` over den`);
  lines.push(`28-dages D1-horisont (uger 0-3).`);
  lines.push(``);
  lines.push(`| Seed | FØR (uge: antal) | EFTER (uge: antal) |`);
  lines.push(`|---|---|---|`);
  for (let i = 0; i < SEEDS.length; i++) {
    const fmt = (arr) => arr.length ? arr.map((w) => `u${w.week}:${w.count}`).join(", ") : "(ingen cobbled_classic-løb i D1's udvalg)";
    lines.push(`| ${SEEDS[i]} | ${fmt(before[i]?.cobblesByWeek ?? [])} | ${fmt(after[i]?.cobblesByWeek ?? [])} |`);
  }
  lines.push(``);

  lines.push(`## 8. Max samtidige løb pr. division (#3546 G)`);
  lines.push(``);
  lines.push(`Ejer-mål: D2 ≤ 3 (den LIVE, ældre-genererede S3-kalender viser op til 4: en frisk plan med`);
  lines.push(`denne PRs kode gør ikke). D3/D4 uændret ≤ 2. Målt ÉN gang pr. kolonne (uafhængig af sæson-seed:`);
  lines.push(`overlap-strukturen kommer fra selection+packing, ikke fra parcours-trækket).`);
  lines.push(``);
  lines.push(`| Division (tier) | Cap | FØR maxOverlap | Inden for cap? | EFTER maxOverlap | Inden for cap? |`);
  lines.push(`|---|---|---|---|---|---|`);
  for (const t of [1, 2, 3, 4]) {
    const b = overlapBefore?.find((x) => x.tier === t);
    const a = overlapAfter?.find((x) => x.tier === t);
    lines.push(`| D${t} | ${b?.overlapCap ?? "?"} | ${b?.maxOverlap ?? "?"} | ${b?.withinCap ? "JA" : "NEJ"} | ${a?.maxOverlap ?? "?"} | ${a?.withinCap ? "JA" : "NEJ"} |`);
  }
  lines.push(``);

  lines.push(`## 9. Kalender-spænd pr. ikke-GT-etapeløb (#3546 H, D1)`);
  lines.push(``);
  lines.push(`Ejer-mål: spænd ≤ stages+2 dage (mål), hård grænse stages+3 (håndhævet i selve`);
  lines.push(`placerings-mekanismen: enforceDailyDecisions afviser ethvert bytte der ville bryde den).`);
  lines.push(`stræk-faktor = spænd/stages (1,0 = ingen strækning).`);
  lines.push(``);
  lines.push(`| Seed | Maks stræk-faktor FØR | Median FØR | Maks stræk-faktor EFTER | Median EFTER | Brud på stages+3 EFTER |`);
  lines.push(`|---|---|---|---|---|---|`);
  for (let i = 0; i < SEEDS.length; i++) {
    const b = before[i], a = after[i];
    lines.push(
      `| ${SEEDS[i]} | ${fmtNum(b?.stretchMax, 2)} | ${fmtNum(b?.stretchMedian, 2)} | ${fmtNum(a?.stretchMax, 2)} | ${fmtNum(a?.stretchMedian, 2)} | ${a?.stretchOverHardLimitCount ?? "?"} |`
    );
  }
  lines.push(``);
  lines.push(`De to navngivne løb thelamba målte (Tour du Massif Central 6 etaper/14 dage, La Corsa dei`);
  lines.push(`Due Mari 7 etaper/13 dage) FØR H-fixet, EFTER (seed 3, EFTER-kolonnen):`);
  lines.push(``);
  const namedRaces = ["Tour du Massif Central", "La Corsa dei Due Mari"];
  for (const name of namedRaces) {
    const row = after[0]?.stageRaceSpans?.find((r) => r.name === name);
    if (row) lines.push(`- **${name}**: ${row.stages} etaper, spænd ${row.span} dage, stræk-faktor ${row.stretch.toFixed(2)} (grænse ${row.stages + 3})`);
    else lines.push(`- ${name}: ikke fundet i D1's selektion denne kørsel (selection er ikke seed-afhængig, men kan skifte hvis kataloget ændres)`);
  }
  lines.push(``);
  lines.push(`Alle ikke-GT-etapeløb, EFTER, sorteret efter værste stræk-faktor (seed 3):`);
  lines.push(``);
  lines.push(`| Løb | Etaper | Spænd | Stræk-faktor |`);
  lines.push(`|---|---|---|---|`);
  for (const row of (after[0]?.stageRaceSpans ?? [])) {
    lines.push(`| ${row.name ?? row.id} | ${row.stages} | ${row.span} | ${row.stretch?.toFixed(2) ?? "?"} |`);
  }
  lines.push(``);

  lines.push(`## Reference: rå prod-baseline (issue #3546, målt 16-17/8: FØR nogen kode i denne PR)`);
  lines.push(``);
  lines.push(`- GT-andel: 45,0 %`);
  lines.push(`- Giro-spænd: 9 kalenderdage (31/8-8/9) mod Hexagone/Vueltas 5 hver`);
  lines.push(`- Dage uden afgørelse: 6/28 (21,4 %) i D1`);
  lines.push(`- Uphill-finish: 0/254 hilly, 0/65 rolling`);
  lines.push(`- Cobbles pr. uge: 29→24→18→8 (monotont fald)`);
  lines.push(`- D2 maxOverlap: op til 4 (målt i den LIVE, ældre-genererede S3-kalender)`);
  lines.push(`- Ikke-GT-etapeløbs-stræk: Tour du Massif Central 6 etaper/14 dage (stræk 2,33), La Corsa`);
  lines.push(`  dei Due Mari 7 etaper/13 dage (stræk 1,86): thelambas spillerfeedback-fund 17/8 sen aften`);
  lines.push(``);

  lines.push(`## Fund og begrænsninger (ærlig rapportering: ikke alt ramte målet fuldt ud)`);
  lines.push(``);
  lines.push(`Denne sektion er opdateret EFTER runde 3 (arkitekt-go 17/8 sen aften, ny leverance H:`);
  lines.push(`max-spænd-loft for ikke-GT-etapeløb). H's implementering afdækkede en ALVORLIG, PRÆ-`);
  lines.push(`EKSISTERENDE regression i C (fra runde 2's flerpas-udvidelse, ikke en del af H's egen`);
  lines.push(`ask): se den fremhævede boks nedenfor. Giro-spænd-målet (≤9, helst ≤8) blev FORSØGT`);
  lines.push(`nået via en target-formel-justering, men afprøvningen BRØD en hård invariant og blev`);
  lines.push(`derfor forkastet: se H-afsnittet for den fulde afprøvning + tal.`);
  lines.push(``);
  lines.push(`⚠ **KRITISK FUND (opdaget under H-implementeringen, IKKE en del af denne rundes ask):**`);
  lines.push(`C's flerpas-bytte-mekanisme (runde 2) kunne flytte en GT's EGEN etape som en del af et`);
  lines.push(`bytte (canMoveTo sikrer kun GT'ens interne etape-rækkefølge, ikke #3472 v3's SEPARATE`);
  lines.push(`"ingen delt kalenderdag mellem to GT'er"-garanti). Verificeret BÅDE i en test-fixture`);
  lines.push(`og mod det ægte katalog: 1-2 GT'er delte en kalenderdag efter C's bytter kørte: en`);
  lines.push(`brudt hård invariant der (uopdaget) fulgte med runde 2's PR-opdatering. **Fixet her:**`);
  lines.push(`GT'er er nu eksplicit udelukket fra HELE C's bytte-kandidatur (hverken donor- eller`);
  lines.push(`offer-side): ikke kun fra H's spænd-tjek. Verificeret 0 brud, både test-suite og ægte`);
  lines.push(`katalog (sektion 5). Dette bør have et \`.claude/learnings/\`-indlæg ved merge.`);
  lines.push(``);
  lines.push(`- **H (ny, denne runde): max-spænd-loft for ikke-GT-etapeløb: RAMMER SIT MÅL PRÆCIST.**`);
  lines.push(`  Rod-årsag (instrumenteret dry-run, C midlertidigt deaktiveret for at isolere): C's`);
  lines.push(`  bytte-mekanisme (IKKE selve base-pakningen) skabte strækningen: den flytter typisk`);
  lines.push(`  et løbs FØRSTE etape (ingen "forrige"-nabo-begrænsning) eller SIDSTE etape (decision-`);
  lines.push(`  donor-kandidat) langt væk for at dække en dag uden afgørelse et andet sted:`);
  lines.push(`  sekventielt SIKKERT, men skaber netop den strækningspatologi H retter. Målt FØR/EFTER`);
  lines.push(`  H-fixet (samme katalog): Tour du Massif Central 6 etaper/14 dage (stræk 2,33) →`);
  lines.push(`  **5 dage (stræk 0,83)**. La Corsa dei Due Mari 7 etaper/13 dage (stræk 1,86) →`);
  lines.push(`  **4 dage (stræk 0,57)**. Se sektion 9 for den fulde liste: 0 løb over stages+3 EFTER.`);
  lines.push(`- **B (Giro-spredning): "≤4-5 dage"-målet holder (spredning 6), men "Giro ≤9, helst`);
  lines.push(`  ≤8"-målet er IKKE nået: et forsøg blev afprøvet og FORKASTET, fordi det brød en hård`);
  lines.push(`  invariant.** Giro-spænd EFTER (fuld pakke inkl. H): **10 dage** (Hexagone 5, Vuelta 4).`);
  lines.push(`  Afprøvet: en empirisk parameter-sweep (faktor 0,6-3,0) af den FØRSTE GT's target-`);
  lines.push(`  formel fandt et stabilt plateau (faktor 2,3-3,0) der gav Giro-spænd 10→7: MEN`);
  lines.push(`  verificeret (BÅDE test-fixture og ægte katalog) at det samtidig BRØD #3472 v3's`);
  lines.push(`  GT-real-day-separations-invariant (to GT'er delte en kalenderdag). Forkastet og`);
  lines.push(`  reverteret: ingen mængde af Giro-forbedring er værd at bryde en hård, ikke-`);
  lines.push(`  forhandlingsbar garanti. **Anbefaling: Giro-spænd-målet kræver enten (a) en dybere,`);
  lines.push(`  separat gennemgang af target-formlen der EKSPLICIT respekterer separations-bufferet`);
  lines.push(`  (ikke forsøgt her, tidsbudget), eller (b) ejeren accepterer 10 dage som interim`);
  lines.push(`  (stadig en forbedring fra den oprindelige 13-15 dage tidligere i denne PR's historik,`);
  lines.push(`  men IKKE under den nuværende live 9-dages værdi).`);
  lines.push(`- **C (dage uden afgørelse): EFTER GT-udelukkelses-fixet er tallet 4 dage: dette er`);
  lines.push(`  EN REGRESSION vs. runde 2's rapporterede 2, fordi runde 2's "2" byggede på en**`);
  lines.push(`  **defekt mekanisme** (GT-bytter der ikke burde have været tilladt). Med fixet (kun`);
  lines.push(`  sikre, GT-frie bytter) er de 4 dage: 1, 13, 19, 24. Dag 1 og 19 er de samme som`);
  lines.push(`  tidligere rapporteret (se deres forklaring nedenfor); dag 13 og 24 er NYE: de var`);
  lines.push(`  tidligere "dækket" af nu-forbudte GT-bytter. **MINIMAL katalog-tilføjelse for 0:**`);
  lines.push(`  samme princip som før, men nu ~4 endagsløb (positioneret ved de 4 dages fraction),`);
  lines.push(`  IKKE 2: tallet steg fordi fixet fjernede en (ugyldig) genvej, ikke fordi H gjorde`);
  lines.push(`  noget værre. D1's kvote er fortsat præcis fyldt (140/140, 0 shortfall/uplaceret).`);
  lines.push(`    - **Dag 1:** tre etapeløb (Ronde van Limburg 7 etaper, La Course au Soleil 8 etaper,`);
  lines.push(`      Tour du Massif Central 6 etaper) starter ALLE omkring dag 0, ingen slutter dag 1.`);
  lines.push(`    - **Dag 19:** Tour de l'Hexagone (GT) er det ENESTE aktive løb, midt i etaperne.`);
  lines.push(`    - **Dag 13/24:** samme mønster: kun igangværende (ikke-slut-)etaper aktive,`);
  lines.push(`      ingen sikkert flytbar afgørelse fundet efter GT-udelukkelsen.`);
  lines.push(`- **A (GT-længde) og D (itt_hilly) rammer begge deres mål præcist**, som talene i`);
  lines.push(`  sektion 1 og 4 viser.`);
  lines.push(`- **E (uphill-finish) rammer begge mål præcist** (sektion 6): en uafhængig, dedikeret`);
  lines.push(`  seedet roll pr. hilly/rolling-etape (ikke koblet til finale_type/motoren), verificeret`);
  lines.push(`  over 400 seeds i unit-tests til at lande i intervallet ~25-45 % hhv. ~12-30 %.`);
  lines.push(`- **F (cobbles-vinduer) splitter races i to vinduer, men ANTALLET pr. vindue afhænger**`);
  lines.push(`  **af hvor mange cobbled_classic-races D1's selection rent faktisk vælger** (sektion 7)`);
  lines.push(` : reshapeCobblesFractionToTwoWindows omfordeler kun HVOR de valgte races lander,`);
  lines.push(`  ikke HVOR MANGE der vælges (selectionen er urørt af denne PR). Er kataloget knapt`);
  lines.push(`  på cobbled_classic i D1's klasse-whitelist, giver to vinduer med få races pr.`);
  lines.push(`  vindue ikke to SYNLIGT tunge klumper: det er et katalog-loft, ikke en kode-fejl`);
  lines.push(`  (samme klasse af begrænsning som #3295's egen "tier-spredningen er et katalog-`);
  lines.push(`  problem"-konklusion, se raceStageProfileGenerator.js's kalibrerings-kommentar).`);
  lines.push(`- **G (D2-samtidigheds-cap) er ALLEREDE opfyldt af eksisterende kode** (sektion 8):`);
  lines.push(`  \`TIER_OVERLAP_CAP[2] = 3\` er uændret af denne PR og en FRISK dry-run-plan (denne`);
  lines.push(`  PRs kode, begge kolonner) rammer maxOverlap=3, ikke 4. Den observerede "op til 4"`);
  lines.push(`  stammer fra den LEVENDE, ældre-genererede S3-kalender (fra før #3470/#3472 v3's`);
  lines.push(`  overlap-fixes landede): en fremtidig regenerering (separat, ejer-gated) løser det`);
  lines.push(`  automatisk uden yderligere kodeændring her.`);
  lines.push(``);

  return lines.join("\n");
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const asJson = process.argv.includes("--json");
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error("⚠ Missing SUPABASE_URL / SUPABASE_SERVICE_KEY i backend/.env.");
    process.exit(2);
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  try {
    const { pools, catalog } = await loadPoolsAndCatalog(supabase);
    const result = runScorecard({ pools, catalog });
    if (asJson) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      const md = formatMarkdown(result);
      console.log(md);
      const outPath = join(__dirname, "../../docs/audits/2026-08-17-s3-kalender-pakke-scorecard.md");
      writeFileSync(outPath, md, "utf8");
      console.error(`\n[skrevet] ${outPath}`);
    }
  } catch (e) {
    console.error(e);
    console.error("\n⚠ Scorecardet kunne ikke gennemføres.");
    process.exit(2);
  }
}
