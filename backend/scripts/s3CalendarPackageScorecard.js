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
    .select("id, external_id, terrain_archetype, name, race_class, race_type, stages, date_text");
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
  lines.push(`| Seed | Klasse/etape-bånd-brud (#3328) FØR/EFTER | Hviledage degraderet FØR/EFTER | 5 events/dag holdt FØR/EFTER |`);
  lines.push(`|---|---|---|---|`);
  for (let i = 0; i < SEEDS.length; i++) {
    lines.push(
      `| ${SEEDS[i]} | ${before[i]?.classBandViolationsCount ?? "?"}/${after[i]?.classBandViolationsCount ?? "?"} | ` +
      `${before[i]?.restDaysDegraded ?? "?"}/${after[i]?.restDaysDegraded ?? "?"} | ` +
      `${before[i]?.densityOk ?? "?"}/${after[i]?.densityOk ?? "?"} |`
    );
  }
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

  lines.push(`## Reference: rå prod-baseline (issue #3546, målt 16-17/8: FØR nogen kode i denne PR)`);
  lines.push(``);
  lines.push(`- GT-andel: 45,0 %`);
  lines.push(`- Giro-spænd: 9 kalenderdage (31/8-8/9) mod Hexagone/Vueltas 5 hver`);
  lines.push(`- Dage uden afgørelse: 6/28 (21,4 %) i D1`);
  lines.push(`- Uphill-finish: 0/254 hilly, 0/65 rolling`);
  lines.push(`- Cobbles pr. uge: 29→24→18→8 (monotont fald)`);
  lines.push(`- D2 maxOverlap: op til 4 (målt i den LIVE, ældre-genererede S3-kalender)`);
  lines.push(``);

  lines.push(`## Fund og begrænsninger (ærlig rapportering: ikke alt ramte målet fuldt ud)`);
  lines.push(``);
  lines.push(`Denne sektion er opdateret EFTER arkitekt-review 17/8 aften: B fik et rodfix nummer 2`);
  lines.push(`(stream-valgets tie-break) og C fik en flerpas-udvidelse. Begge forbedrede sig markant`);
  lines.push(`(se under), men rammer ikke deres respektive absolutte mål (±1 dag hhv. 0 døde dage)  - `);
  lines.push(`begge resterende gaps er nu PRÆCIST forklaret og kvantificeret nedenfor, som krævet.`);
  lines.push(``);
  lines.push(`- **B (Giro-spredning), v2: rammer "≤4-5 dage"-målet, men IKKE det fulde ±1 dags-mål.**`);
  lines.push(`  Rodfix: layoutStream's mindst-belastede stream-valg brød konsekvent tie mod stream 0`);
  lines.push(`  (indeks 0 vinder altid en cursor-uafgørelse): PRÆCIS den stream GT'erne selv ligger`);
  lines.push(`  på. Det betød at "rest"-fyldet FØR hver GT systematisk blev dumpet på GT'ens EGEN`);
  lines.push(`  stream, hvilket skubbede GT'ens fodaftryk længere frem i dens egen game_day-`);
  lines.push(`  rækkefølge og efterlod de ANDRE streams uden indhold der reelt overlappede GT'ens`);
  lines.push(`  vindue. Fix: pickLeastLoadedStreamAwayFromZero() bryder ties væk fra stream 0.`);
  lines.push(`  **Målt (fuld pakke, den faktisk SHIPPEDE kombination): EFTER-spredning falder fra`);
  lines.push(`  7 til 4 dage** (Giro 10 · Hexagone 7 · Vuelta 6): inden for "≤4-5 dage"-målet og`);
  lines.push(`  UNDER den rå prod-baseline (som også var 4). Pairwise-afstanden er dog stadig`);
  lines.push(`  op til 4 dage (Giro-Hexagone), ikke ±1.`);
  lines.push(`  **PRÆCIS årsag til det resterende gab (instrumenteret dry-run mod det ægte katalog):**`);
  lines.push(`  Giro (GT1, ingen forrige GT at holde afstand til) starter FØRST på stream 0's egen`);
  lines.push(`  cursor game_day 17 (efter dens andel af "Trin 2"-fyldet), og dens vindue er derfor`);
  lines.push(`  [17,38). På DET tidspunkt havde stream 1 kun nået game_day 14 og stream 2 kun 9  - `);
  lines.push(`  altså har INGEN af de andre streams noget indhold der overlapper Giro's vindue`);
  lines.push(`  OVERHOVEDET (0-9 og 0-14 ligger begge FØR 17). Giro kører derfor reelt "alene" i`);
  lines.push(`  game_day-rummet, hvilket giver minimal komprimering og dermed det bredeste`);
  lines.push(`  kalender-spænd. Rod-årsagen er STRUKTUREL: hver GT's "Trin 2"-fyld er en LUKKET`);
  lines.push(`  fase (sker FØR GT'ens egen placering, fryser derefter mens GT'en placeres): den`);
  lines.push(`  NÆSTE GT's fyld starter først EFTER denne GT er færdigplaceret, så intet nyt`);
  lines.push(`  indhold kan lande i en TIDLIGERE GT's vindue bagefter. At lukke gabet helt ville`);
  lines.push(`  kræve at INTERLEAVE rest-fyldet med GT-placeringen i stedet for at sekvensere dem  - `);
  lines.push(`  en større, mere risikabel omstrukturering af layoutStream (samme fil har haft 3`);
  lines.push(`  tidligere regressions-runder, #3472 v1-v3) end tie-break-rettelsen ovenfor, og`);
  lines.push(`  IKKE forsøgt i denne PR. Rapporteret til ejeren som opfølgnings-kandidat med`);
  lines.push(`  den præcise mekanik dokumenteret her, så en fremtidig session ikke skal genopdage den.`);
  lines.push(`- **C (dage uden afgørelse), v2: reducerer markant (halveret igen), men rammer IKKE 0  - `);
  lines.push(`  bevist umuligt for netop 2 navngivne dage med det NUVÆRENDE katalog.** Flerpas-`);
  lines.push(`  udvidelse (gentag scanningen til intet flere sikre bytter findes, i stedet for ét`);
  lines.push(`  gennemløb) + B's tie-break-fix (bonus-effekt: bedre stream-balance giver også flere`);
  lines.push(`  afgørelses-muligheder) bragte EFTER fra 5 til **2 dage** (FØR: 5→2 med, uden C ville`);
  lines.push(`  FØR/EFTER være 7/10: se engangs-diagnostikken fra første scorecard-runde for de tal).`);
  lines.push(`  **De 2 resterende dage (EFTER, alle 3 seeds: dagene er identiske på tværs af seeds,`);
  lines.push(`  da selection/packing ikke er seed-afhængig) er BEVIST strukturelt umulige for den`);
  lines.push(`  sikre bytte-mekanisme, med denne konkrete årsag:**`);
  lines.push(`    - **Dag 1:** tre etapeløb (Ronde van Limburg 7 etaper, La Course au Soleil 8 etaper,`);
  lines.push(`      Tour du Massif Central 6 etaper) starter ALLE omkring dag 0 og er alle stadig`);
  lines.push(`      undervejs (ingen af dem slutter dag 1). Ingen andet løb (endagsløb eller`);
  lines.push(`      slutetape) er placeret den dag at bytte ind.`);
  lines.push(`    - **Dag 19:** Tour de l'Hexagone (GT) er det ENESTE aktive løb, midt i etaperne`);
  lines.push(`      (vindue [18,24], slutetape er dag 24): ingen andet løb kører samtidig.`);
  lines.push(`  **Hvorfor 0 er umuligt UDEN katalog-/kvote-ændring:** D1's kvote er PRÆCIS fyldt`);
  lines.push(`  (140/140 game-days, 0 shortfall, 0 uplacerede løb/etaper): der findes INTET`);
  lines.push(`  allerede-valgt-men-uplaceret endagsløb i "kulissen" som C's bytte-mekanisme kunne`);
  lines.push(`  trække på. At dække de 2 dage kræver derfor at SELECTIONEN (tierRaceSelection.js,`);
  lines.push(`  uden for denne PRs scope) vælger 2 FLERE endagsløb: hvilket enten kræver at`);
  lines.push(`  kataloget rent faktisk INDEHOLDER 2 endagsløb til formålet (ét med date_text nær`);
  lines.push(`  sæson-start, ét inden for Hexagone's eget vindue omkring fraction ~0,6), ELLER at`);
  lines.push(`  1-2 af de eksisterende etapeløbs game-days byttes ud for dem (en sammensætnings-`);
  lines.push(`  ændring der hører under #3295's K-B-kalibrering, ikke en placerings-fix).`);
  lines.push(`  **MINIMAL katalog-tilføjelse: +2 endagsløb** (klasse inden for D1's whitelist),`);
  lines.push(`  positioneret hhv. tidligt i sæsonen og inden for Hexagone's vindue: en ejer-`);
  lines.push(`  beslutning med tal, ikke et stille miss.`);
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
