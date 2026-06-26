// READ-ONLY preview (Task 5 / #1856): scorecard for den nye kalender-motor mod ægte
// prod-data. INGEN writes — kun SELECT mod race_pool/league_divisions/teams. Importerer
// de RENE generator-/schedule-/binding-funktioner og kører dem mod det ægte katalog, så
// vi kan SE hvad motoren producerer (140 race-dage/division, garanteret endagsløb-kvote,
// 5 etaper/dag) FØR vi rører prod.
//
// Kør: cd backend && infisical run --env=prod -- node scripts/dev/preview-calendar-rework.mjs
import { createClient } from "@supabase/supabase-js";
import { generateDivisionCalendars } from "../../lib/divisionCalendarGenerator.js";
import { planRaceSchedules, STAGE_SLOTS_CET } from "../backfillRaceScheduledFor.js";
import { raceBindingWindow, peakConcurrentStageRaces } from "../../lib/raceBinding.js";
import {
  DEFAULT_TIER_RACE_CLASSES,
  MONUMENT_RACE_CLASS,
} from "../../lib/divisionCalendarGenerator.js";

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Mangler SUPABASE_URL / SUPABASE_SERVICE_KEY (kør via infisical run --env=prod)");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const RACE_DAYS_TARGET = 140;
const TRACKS = 5;
const SCHEDULE_FROM = new Date("2026-06-27T00:00:00Z");

// "Ægte manager"-diskriminator — SAMME som materializeren/aiTeamGenerator.
function isRealManager(team) {
  return team.is_ai === false && !team.is_bank && !team.is_frozen && !team.is_test_account;
}

const pad = (s, n) => String(s).padEnd(n);
const lpad = (s, n) => String(s).padStart(n);

async function main() {
  // 1. race_pool = kataloget.
  const { data: catalog, error: catErr } = await supabase
    .from("race_pool").select("id, name, race_class, race_type, stages");
  if (catErr) throw new Error(`race_pool: ${catErr.message}`);

  // 2. league_divisions (id, tier, label, pool_index hvis findes).
  let pools;
  {
    const { data, error } = await supabase
      .from("league_divisions").select("id, tier, pool_index, label").order("tier").order("pool_index");
    if (error) throw new Error(`league_divisions: ${error.message}`);
    pools = data || [];
  }

  // 2b. Berig hver pulje med realManagerCount.
  const { data: teams, error: teamErr } = await supabase
    .from("teams").select("id, is_ai, is_bank, is_frozen, is_test_account, league_division_id");
  if (teamErr) throw new Error(`teams: ${teamErr.message}`);
  const realCountByPool = new Map();
  for (const t of teams || []) {
    if (isRealManager(t) && t.league_division_id != null) {
      realCountByPool.set(t.league_division_id, (realCountByPool.get(t.league_division_id) || 0) + 1);
    }
  }
  const poolsWithCounts = pools.map((p) => ({ ...p, realManagerCount: realCountByPool.get(p.id) || 0 }));

  // 3. Kør generatoren.
  const calendars = generateDivisionCalendars({
    pools: poolsWithCounts,
    catalog: catalog || [],
    raceDaysTarget: RACE_DAYS_TARGET,
    allowReuseAcrossPools: true, // parallelle puljer må genbruge løb (ejer-beslutning 26/6)
  });
  const truncated = calendars.truncated || [];
  const truncByDiv = new Map(truncated.map((t) => [t.leagueDivisionId, t]));

  // 4+5. Pr. division: schedule + peak concurrency + scorecard-felter.
  const isMonument = (r) => r.race_class === MONUMENT_RACE_CLASS && r.race_type === "single";
  const rows = [];
  for (const cal of calendars) {
    const single = cal.races.filter((r) => r.race_type === "single").length;
    const stage = cal.races.filter((r) => r.race_type === "stage_race").length;
    const monuments = cal.races.filter(isMonument).length;

    // Schedule puljens løb på TRACKS parallelle spor.
    const { stageRows } = planRaceSchedules({ races: cal.races, from: SCHEDULE_FROM, tracks: TRACKS, stageRaceTracks: 2 });
    const stageByRace = new Map();
    for (const s of stageRows) {
      if (!stageByRace.has(s.race_id)) stageByRace.set(s.race_id, []);
      stageByRace.get(s.race_id).push(s);
    }
    // Byg binding-vindue-liste pr. race (kun stage_race tæller i peak, men vi giver alle med).
    const windowList = cal.races.map((r) => ({
      league_division_id: cal.leagueDivisionId,
      race_type: r.race_type,
      window: raceBindingWindow(stageByRace.get(r.id) || []),
    }));
    const peakStage = peakConcurrentStageRaces(windowList, { divisionId: cal.leagueDivisionId });

    const tr = truncByDiv.get(cal.leagueDivisionId);
    rows.push({
      poolId: cal.leagueDivisionId,
      tier: cal.tier,
      label: cal.label,
      realManagers: realCountByPool.get(cal.leagueDivisionId) || 0,
      totalRaceDays: cal.totalRaceDays,
      single,
      stage,
      monuments,
      peakStage,
      truncated: !!tr,
      stageShort: tr ? tr.stageRacesShort : 0,
    });
  }

  // ── PRINT: scorecard pr. division ───────────────────────────────────────────
  console.log("\n================ SCORECARD PR. DIVISION (mål 140 race-dage) ================\n");
  console.log(
    pad("pool", 6) + pad("tier", 5) + pad("mgrs", 5) +
    lpad("raceDays", 9) + lpad("single", 8) + lpad("stage", 7) + lpad("monu", 6) +
    lpad("peakStg", 9) + "  truncated",
  );
  console.log("-".repeat(78));
  for (const r of rows.sort((a, b) => a.tier - b.tier || a.poolId - b.poolId)) {
    const trunc = r.truncated ? `JA (-${r.stageShort} etapeløb)` : "nej";
    const flag = r.totalRaceDays < RACE_DAYS_TARGET ? " ◄ under 140" : "";
    console.log(
      pad(r.poolId, 6) + pad(r.tier, 5) + pad(r.realManagers, 5) +
      lpad(r.totalRaceDays, 9) + lpad(r.single, 8) + lpad(r.stage, 7) + lpad(r.monuments, 6) +
      lpad(r.peakStage, 9) + "  " + trunc + flag,
    );
  }

  // ── PRINT: katalog-oversigt ─────────────────────────────────────────────────
  const cat = catalog || [];
  const totalCatalogRaceDays = cat.reduce((s, r) => s + (Number(r.stages) || 1), 0);
  const need = 7 * RACE_DAYS_TARGET;
  console.log("\n================ KATALOG-OVERSIGT ================\n");
  console.log(`Race-pool entries (løb):           ${cat.length}`);
  console.log(`Race-dage total i kataloget:       ${totalCatalogRaceDays}`);
  console.log(`Behov hvis ALLE 7 div × 140:       ${need}`);
  console.log(`Dækning (global, hvis de-dup'et):  ${(100 * totalCatalogRaceDays / need).toFixed(1)}%`);
  const singles = cat.filter((r) => r.race_type === "single");
  const stages = cat.filter((r) => r.race_type === "stage_race");
  console.log(`  heraf endagsløb:                 ${singles.length} (${singles.length} race-dage)`);
  console.log(`  heraf etapeløb:                  ${stages.length} (${stages.reduce((s, r) => s + (Number(r.stages) || 1), 0)} race-dage)`);
  console.log(`  heraf monumenter (${MONUMENT_RACE_CLASS}):     ${cat.filter(isMonument).length}`);

  // Pr. tier: hvor mange race-dage er tilgængelige i tier-klasserne (med overlap mellem tiers).
  console.log("\nPr. tier — race-dage tilgængelige i tier-klasserne (klasser kan overlappe mellem tiers):");
  console.log(
    pad("tier", 6) + pad("klasser", 52) + lpad("løb", 5) + lpad("raceDays", 10) + lpad("stageløb", 10),
  );
  console.log("-".repeat(83));
  for (const tier of [1, 2, 3, 4]) {
    const classes = DEFAULT_TIER_RACE_CLASSES[tier] || [];
    const set = new Set(classes);
    const inTier = cat.filter((r) => set.has(r.race_class));
    const days = inTier.reduce((s, r) => s + (Number(r.stages) || 1), 0);
    const stageCount = inTier.filter((r) => r.race_type === "stage_race").length;
    console.log(
      pad(tier, 6) + pad(classes.join(","), 52) + lpad(inTier.length, 5) + lpad(days, 10) + lpad(stageCount, 10),
    );
  }

  // Race-dage pr. race_class (rå fordeling i kataloget).
  console.log("\nRå fordeling pr. race_class i kataloget:");
  const byClass = new Map();
  for (const r of cat) {
    const k = r.race_class || "(null)";
    if (!byClass.has(k)) byClass.set(k, { count: 0, days: 0, stage: 0 });
    const e = byClass.get(k);
    e.count++;
    e.days += Number(r.stages) || 1;
    if (r.race_type === "stage_race") e.stage++;
  }
  console.log(pad("race_class", 22) + lpad("løb", 5) + lpad("raceDays", 10) + lpad("stageløb", 10));
  console.log("-".repeat(47));
  for (const [k, e] of [...byClass.entries()].sort((a, b) => b[1].days - a[1].days)) {
    console.log(pad(k, 22) + lpad(e.count, 5) + lpad(e.days, 10) + lpad(e.stage, 10));
  }

  // ── KONKRETE SVAR ───────────────────────────────────────────────────────────
  const div1 = rows.find((r) => r.tier === 1);
  console.log("\n================ KONKRETE SVAR ================\n");
  if (div1) {
    console.log(`3) Div 1 (tier 1) endagsløb: ${div1.single} → ${div1.single > 0 ? "IKKE længere ren etapeløb ✔" : "STADIG ren etapeløb ✘"}`);
  } else {
    console.log("3) Ingen tier-1 division returneret (ingen live tier-1 pulje?)");
  }
  const truncRows = rows.filter((r) => r.truncated || r.totalRaceDays < RACE_DAYS_TARGET);
  if (truncRows.length) {
    console.log("4) Truncated / under 140 race-dage:");
    for (const r of truncRows.sort((a, b) => a.tier - b.tier || a.poolId - b.poolId)) {
      console.log(`   pool ${r.poolId} (tier ${r.tier}): ${r.totalRaceDays}/140 race-dage` +
        (r.truncated ? `, mangler ${r.stageShort} etapeløb af quota` : ""));
    }
  } else {
    console.log("4) Ingen division er truncated eller under 140 race-dage.");
  }
  const over2 = rows.filter((r) => r.peakStage > 2);
  console.log(`5) Peak samtidige etapeløb > 2: ${over2.length ? over2.map((r) => `pool ${r.poolId}=${r.peakStage}`).join(", ") : "INGEN (alle ≤ 2)"}`);
  console.log(`   (max peak observeret: ${Math.max(0, ...rows.map((r) => r.peakStage))})`);

  console.log("\n6) READ-ONLY: kun SELECT udført. Ingen writes til prod.\n");
}

main().then(() => process.exit(0)).catch((err) => {
  console.error("FEJL:", err.message);
  console.error(err.stack);
  process.exit(1);
});
