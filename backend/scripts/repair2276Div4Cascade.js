// Reparation #2276: prestige-kaskaden er brudt i Division 4 — tier 4 kørte 5 Monuments +
// 2 OtherWorldTourA (samme løb som tier 1 = dobbelt brud: kaskade + cross-division-dedup),
// samt Tour du Jura duplikeret i tier 3+4. Pulje A havde desuden en gammel skæv skabelon
// (27 vs. 17 løb, 7 fælles løb på forkerte dage).
//
// Rod-årsag (#2276, se backend/lib/tierRaceSelection.js TIER_CLASS_WHITELIST +
// backend/lib/tierCalendarMaterializer.js usedRaceNames): der fandtes KUN en etape-baseret
// GT-gate (#2251), ingen klasse-gate — og cross-tier-dedup var kun hukommelse inden for ÉT
// buildTierMaterializationPlan-kald, ikke persisteret mod allerede-materialiserede tiers i
// DB. Når tier 4 aktiveredes i et separat reconcile-kald, kaskaderede Monuments/OWT-A frit
// ned. Begge huller er lukket i materializeren; dette script reverserer + genopbygger tier 4.
//
// Scope (arkitekt-beslutning 10/7): FULD Div 4-nulstilling — ALLE tier 4-løb slettes (ikke kun
// de kaskade-ulovlige), så alle 8 puljer garanteret har kørt samme løb ved sæsonslut. Afviklede
// løb (uanset klasse) reverseres økonomisk først; den nye kalender bygges fra bunden i rest-
// vinduet [reparationsdag+1, sæsonens sidste løbsdag] ved tæthed 3 (ejer-beslutning 10/7).
//
// KØR ALDRIG mod prod uden ejer-godkendelse — ejeren skal have set live-tilstanden
// (dry-run-output) og godkendt PRÆCIS dette skridt.
//   node scripts/repair2276Div4Cascade.js            → dry-run: viser live state + plan
//   node scripts/repair2276Div4Cascade.js --live     → backup (JSON) + reversering + delete + re-materialisér
//
// Sekvens (D3/#2251-tjekliste, jf. repair2251Tier4GrandTours.js):
//   ✓ from = FREMTIDIG dato (i morgen UTC-midnat) — aldrig scheduled_at <= now på live spil
//   ✓ scheduler-flag slås FRA under kørslen og genoprettes til før-tilstanden bagefter
//   ✓ backup FØR sletning (JSON, races + CHILD_TABLES + finance_transactions for de afviklede)
//   ✓ finance-reversering FØR sletning, idempotent (race_prize_reversal:<raceId>:<teamId>)
//   ✓ fatigue-reset for ryttere med entries i de slettede løb
//   ✓ updateRiderValues (prize_earnings_bonus) + updateStandings + matview-refresh +
//     recomputeSeasonRaceDays EFTER sletning
//   ✓ re-materialisér tier 4 (rettet materializer: whitelist + cross-tier-navne-dedup)

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { writeFileSync, mkdirSync } from "fs";
import { materializeTierCalendars, buildTierMaterializationPlan, TIER_DENSITY } from "../lib/tierCalendarMaterializer.js";
import { TIER_GAME_DAY_QUOTA, TIER_CLASS_WHITELIST } from "../lib/tierRaceSelection.js";
import { classifyIllegalTier4Races, computeFinanceReversals, partitionTier4FullReset } from "../lib/div4CascadeRepair.js";
import { incrementBalanceWithAudit } from "../lib/balanceRpc.js";
import { updateStandings, updateRiderValues } from "../lib/economyEngine.js";
import { refreshRankingMatviewsSafe } from "../lib/refreshRankingMatviews.js";
import { recomputeSeasonRaceDays } from "../lib/seasonRaceDays.js";
import { STAGE_SCHEDULER_FLAG_KEY } from "../lib/stageSchedulerFlag.js";
import { FINANCE_ACTOR_TYPE, FINANCE_REASON, FINANCE_RELATED_ENTITY } from "../lib/economyConstants.js";

const CHILD_TABLES = [
  "race_results",
  "race_simulation_runs",
  "race_entries",
  "race_stage_schedule",
  "race_stage_profiles",
  "race_withdrawals",
];

async function fetchAll(supabase, table, apply) {
  const out = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const q = apply(supabase.from(table).select("*")).range(from, from + PAGE - 1);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

async function realManagerName(supabase, teamId) {
  const { data } = await supabase.from("teams").select("name, is_ai").eq("id", teamId).maybeSingle();
  return data ? `${data.name}${data.is_ai ? " (AI)" : ""}` : teamId;
}

// Ejer-beslutning 10/7 (#2276 opfølgning): Div 4's genopbyggede rest-af-sæson-kalender kører
// tæthed 3 (design-default for tier 4 er 2) i et FORKORTET vindue: reparationsdag+1 til sæsonens
// sidste løbsdag. quota = density × vinduesdage. Kun tier 4 og kun DENNE reparation — design-
// defaults (140/112/84/56, tæthed 5/4/3/2) er uændrede for alle andre tiers/sæsoner (fra sæson 2
// gælder design-kvoterne for tier 4 igen).
const DIV4_REPAIR_DENSITY = 3;

/**
 * Udleder rest-af-sæson-vinduet for #2276-reparationen: `from` = i morgen (UTC-midnat,
 * Europe/Copenhagen-dagsgrænsen er allerede UTC-midnat-alignet i buildScheduleRows), og
 * sæson-slut = max(scheduled_at) over de UBERØRTE tier 1-3-puljer (stabilt tal, uafhængigt
 * af om tier 4's ulovlige løb slettes før eller efter kaldet — så dry-run og --live regner
 * PRÆCIS samme vindue). Hardcoder ALDRIG en dato — udledes af prod-data hver gang.
 */
async function computeDiv4RestOfSeasonWindow({ supabase, seasonId, lowerTierPoolIds, now }) {
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const { data: lowerRaces, error: lrErr } = await supabase
    .from("races").select("id").eq("season_id", seasonId).in("league_division_id", lowerTierPoolIds);
  if (lrErr) throw new Error(`races (tier 1-3 horisont): ${lrErr.message}`);
  const lowerRaceIds = (lowerRaces || []).map((r) => r.id);
  let maxAt = null;
  for (let i = 0; i < lowerRaceIds.length; i += 200) {
    const { data: sched, error } = await supabase
      .from("race_stage_schedule").select("scheduled_at").in("race_id", lowerRaceIds.slice(i, i + 200));
    if (error) throw new Error(`race_stage_schedule (horisont): ${error.message}`);
    for (const s of sched || []) {
      const t = Date.parse(s.scheduled_at);
      if (Number.isFinite(t) && (maxAt == null || t > maxAt)) maxAt = t;
    }
  }
  if (maxAt == null) throw new Error("kunne ikke bestemme sæson-slut fra tier 1-3-kalenderen");
  const end = new Date(maxAt);
  const endDayUtc = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  const realDays = Math.floor((endDayUtc - from.getTime()) / 86_400_000);
  return { from, seasonEnd: end, realDays };
}

/**
 * Rene (I/O-fri undtagen én katalog/pulje-hentning) preview af den nye tier 4-kalender —
 * bruges af BÅDE dry-run (til ejer-godkendelse) og som sandhed for hvad --live vil skrive.
 * Bygger planen via buildTierMaterializationPlan (samme sti som materializeTierCalendars)
 * med override-tæthed/kvote for tier 4 og usedRaceNames seedet fra tier 1-3 (cross-tier-dedup
 * holder selv når kun tier 4 materialiseres i dette kald).
 */
async function buildDiv4RepairPlan({ supabase, tier4PoolIds, tier1to3Names, from, realDays }) {
  const { data: divisions, error: dErr } = await supabase
    .from("league_divisions").select("id, tier, pool_index, label").in("id", tier4PoolIds);
  if (dErr) throw new Error(`league_divisions (div4-plan): ${dErr.message}`);
  const { data: teams, error: tErr } = await supabase
    .from("teams").select("league_division_id, is_ai, is_bank, is_frozen, is_test_account").in("league_division_id", tier4PoolIds);
  if (tErr) throw new Error(`teams (div4-plan): ${tErr.message}`);
  const realByDiv = new Map();
  for (const t of teams || []) {
    if (t.is_ai === false && !t.is_bank && !t.is_frozen && !t.is_test_account && t.league_division_id != null) {
      realByDiv.set(t.league_division_id, (realByDiv.get(t.league_division_id) || 0) + 1);
    }
  }
  const pools = (divisions || []).map((d) => ({ id: d.id, tier: d.tier, label: d.label, realManagerCount: realByDiv.get(d.id) || 0 }));
  const { data: catalog, error: cErr } = await supabase
    .from("race_pool").select("id, external_id, terrain_archetype, name, race_class, race_type, stages");
  if (cErr) throw new Error(`race_pool (div4-plan): ${cErr.message}`);

  const density = { ...TIER_DENSITY, 4: DIV4_REPAIR_DENSITY };
  const quotas = { ...TIER_GAME_DAY_QUOTA, 4: DIV4_REPAIR_DENSITY * realDays };
  const { tierPlans } = buildTierMaterializationPlan({
    pools, catalog: catalog || [], from, realDays, quotas, density, forceTiers: [4],
    usedRaceNames: tier1to3Names,
  });
  return { tier4Plan: tierPlans.find((tp) => tp.tier === 4) ?? null, quotas, density };
}

/** Formatterer en tier-plan dag-for-dag (dato, game days, løb m. klasse+etaper) til ejer-godkendelse. */
function formatDailyCalendar({ tier4Plan, from, log }) {
  if (!tier4Plan) { log("  (ingen tier 4-plan — ingen live puljer eller intet katalog tilgængeligt)"); return; }
  const pool = tier4Plan.pools[0];
  if (!pool) { log("  (ingen puljer)"); return; }
  const raceByPoolRaceId = new Map(pool.raceRows.map((r) => [r.pool_race_id, r]));
  const byDate = new Map(); // dateStr -> [{ name, race_class, stage_number, stages }]
  for (const s of pool.stageRows) {
    const r = raceByPoolRaceId.get(s.pool_race_id);
    const dateStr = new Date(s.scheduled_at).toISOString().slice(0, 10);
    if (!byDate.has(dateStr)) byDate.set(dateStr, []);
    byDate.get(dateStr).push({ name: r?.name ?? s.pool_race_id, race_class: r?.race_class ?? "?", stage_number: s.stage_number, stages: r?.stages ?? 1 });
  }
  const dates = [...byDate.keys()].sort();
  log(`  vindue: ${from.toISOString().slice(0, 10)} (dag+1) → ${dates[dates.length - 1] ?? "?"} · ${dates.length} IRL-dage · tæthed ${tier4Plan.density} · kvote ${tier4Plan.quota} (ramt: ${tier4Plan.quotaHit})`);
  for (const dateStr of dates) {
    const events = byDate.get(dateStr).sort((a, b) => a.name.localeCompare(b.name));
    log(`  ${dateStr} (${events.length} etape(r)):`);
    for (const e of events) log(`    ${e.name} [${e.race_class}] · etape ${e.stage_number}/${e.stages}`);
  }
  if (tier4Plan.calendarViolations?.length) {
    log(`  ⚠ kalender-invarianter BRUDT: ${tier4Plan.calendarViolations.join(" · ")}`);
  }
}

export async function repairDiv4Cascade({ supabase, now = new Date(), dryRun = true, log = console.log }) {
  const { data: season, error: sErr } = await supabase
    .from("seasons").select("id, start_date").eq("status", "active").maybeSingle();
  if (sErr) throw new Error(`seasons: ${sErr.message}`);
  if (!season) throw new Error("ingen aktiv sæson");

  const { data: divisions, error: dErr } = await supabase
    .from("league_divisions").select("id, tier, pool_index, label");
  if (dErr) throw new Error(`league_divisions: ${dErr.message}`);
  const tier4PoolIds = (divisions || []).filter((d) => d.tier === 4).map((d) => d.id);
  const lowerTierPoolIds = (divisions || []).filter((d) => d.tier < 4).map((d) => d.id);
  if (!tier4PoolIds.length) throw new Error("ingen tier 4-puljer");

  const { data: tier4Races, error: rErr } = await supabase
    .from("races")
    .select("id, name, race_class, status, stages, stages_completed, scheduled_for, league_division_id, prize_paid_at, game_day_start")
    .eq("season_id", season.id)
    .in("league_division_id", tier4PoolIds);
  if (rErr) throw new Error(`races (tier 4): ${rErr.message}`);

  const { data: tier1to3Races, error: r13Err } = await supabase
    .from("races").select("name").eq("season_id", season.id).in("league_division_id", lowerTierPoolIds);
  if (r13Err) throw new Error(`races (tier 1-3): ${r13Err.message}`);
  const tier1to3Names = new Set((tier1to3Races || []).map((r) => r.name).filter(Boolean));

  const racesByPool = new Map();
  for (const poolId of tier4PoolIds) racesByPool.set(poolId, []);
  for (const r of tier4Races || []) racesByPool.get(r.league_division_id)?.push(r);

  // Invariant-rapportering (til kontekst i dry-run-output — hvor mange af løbene der var
  // decideret ulovlige). Sletnings-scope er dog FULD nulstilling, se partitionTier4FullReset.
  const { toDelete: illegalRaces } = classifyIllegalTier4Races({
    racesByPool, tier1to3Names, classWhitelist: TIER_CLASS_WHITELIST[4],
  });
  const illegalIds = new Set(illegalRaces.map((d) => d.id));
  const reasonsById = new Map(illegalRaces.map((d) => [d.id, d.reasons]));

  // FULD Div 4-nulstilling (arkitekt-beslutning 10/7): slet ALLE tier 4-løb — ikke kun de
  // kaskade-ulovlige — så alle 8 puljer garanteret har kørt samme løb ved sæsonslut. Afviklede
  // løb (uanset klasse) reverseres økonomisk først; scheduled slettes direkte. Den nye kalender
  // bygges derefter fra bunden i restvinduet ved tæthed 3 (ingen gamle løb at flette rundt om).
  const { toReverse, toDeleteScheduled, allIds: raceIdsToDelete } = partitionTier4FullReset({ races: tier4Races || [] });
  const byId = new Map((tier4Races || []).map((r) => [r.id, r]));
  const playedIds = toReverse.map((r) => r.id);

  log(`\n── FULD Div 4-nulstilling: ${raceIdsToDelete.length} løb i alt på tværs af ${tier4PoolIds.length} puljer (${illegalIds.size} kaskade-ulovlige, ${raceIdsToDelete.length - illegalIds.size} øvrige) ──`);
  if (!raceIdsToDelete.length) {
    // Genkørsel efter fuldført sletning: intet at slette, men kalenderen kan mangle
    // (fx hvis en tidligere kørsel fejlede mellem delete og re-materialisering).
    log("ingen tier 4-løb at slette — springer direkte til re-materialisering");
    const { from, realDays } = await computeDiv4RestOfSeasonWindow({ supabase, seasonId: season.id, lowerTierPoolIds, now });
    if (realDays < 1) throw new Error("sæsonen er ved at slutte — ingen re-materialisering");
    const summary = await materializeTierCalendars({
      supabase, seasonId: season.id, seasonStartDate: season.start_date, from,
      tiers: [4], forceTiers: [4], dryRun, realDays,
      quotas: { ...TIER_GAME_DAY_QUOTA, 4: DIV4_REPAIR_DENSITY * realDays },
      density: { ...TIER_DENSITY, 4: DIV4_REPAIR_DENSITY },
      log,
    });
    log(`re-materialiseret: +${summary.racesInserted} løb, ${summary.stageSchedules} etape-tider`);
    return { deleted: 0, dryRun, ...summary };
  }

  // Finance-reversering for ALLE afviklede tier 4-løb (dry-run beregner + rapporterer, --live udfører).
  const financeTx = playedIds.length
    ? await fetchAll(supabase, "finance_transactions", (q) => q.in("race_id", playedIds))
    : [];
  const reversals = computeFinanceReversals({ transactions: financeTx, raceIds: playedIds });

  // Sektion 1: reverseres — alle afviklede løb med beløb pr. hold.
  log(`\n── Sektion 1: REVERSERES — ${toReverse.length} afviklet(e) løb, ${reversals.length} hold-linjer ──`);
  for (const r of toReverse) {
    const tag = illegalIds.has(r.id) ? ` · [${reasonsById.get(r.id).join(",")}]` : " · [lovlig klasse — fuld nulstilling]";
    log(`  pulje ${r.league_division_id} · ${r.name} [${r.race_class}] · ${r.status}${r.prize_paid_at ? " · præmie udbetalt" : ""}${tag} · ${r.id}`);
  }
  for (const rev of reversals) {
    const name = await realManagerName(supabase, rev.teamId);
    log(`    hold ${name} (${rev.teamId}) · løb ${byId.get(rev.raceId)?.name} · tilbagefør ${rev.amount}`);
  }

  // Sektion 2: slettes — alle scheduled løb med entries/rigtige hold.
  log(`\n── Sektion 2: SLETTES — ${toDeleteScheduled.length} planlagt(e) løb ──`);
  for (const r of toDeleteScheduled) {
    const { data: entryRows, error: entriesErr } = await supabase
      .from("race_entries").select("team_id").eq("race_id", r.id);
    if (entriesErr) throw new Error(`race_entries (${r.id}): ${entriesErr.message}`);
    const teamIds = [...new Set((entryRows || []).map((e) => e.team_id).filter(Boolean))];
    let realTeamCount = 0;
    if (teamIds.length) {
      const { data: teamRows, error: teamsErr } = await supabase
        .from("teams").select("id, is_ai").in("id", teamIds);
      if (teamsErr) throw new Error(`teams (${r.id}): ${teamsErr.message}`);
      realTeamCount = (teamRows || []).filter((t) => t.is_ai === false).length;
    }
    const tag = illegalIds.has(r.id) ? ` · [${reasonsById.get(r.id).join(",")}]` : "";
    log(`  pulje ${r.league_division_id} · ${r.name} [${r.race_class}] · ${r.status} · entries ${entryRows?.length ?? 0} (rigtige hold: ${realTeamCount})${tag} · ${r.id}`);
  }

  // Sektion 3: ny kalender dag-for-dag.
  // Ejer-beslutning 10/7 (#2276 opfølgning): rest-af-sæson-kalenderen for div 4 genopbygges
  // med tæthed 3 (design-default = 2) i vinduet [reparationsdag+1, sæsonens sidste løbsdag]
  // — udledt af tier 1-3's kalender i prod, aldrig hardcodet. Vis dag-for-dag i BÅDE dry-run
  // og --live, så ejeren ser præcis samme plan der bliver skrevet.
  const { from, seasonEnd, realDays } = await computeDiv4RestOfSeasonWindow({ supabase, seasonId: season.id, lowerTierPoolIds, now });
  log(`\n── Sektion 3: NY KALENDER (rest-af-sæson, ejer-beslutning 10/7): ${from.toISOString().slice(0, 10)} → ${seasonEnd.toISOString().slice(0, 10)} (${realDays} IRL-dage) · tæthed ${DIV4_REPAIR_DENSITY} · kvote ${DIV4_REPAIR_DENSITY * realDays} ──`);
  const { tier4Plan } = await buildDiv4RepairPlan({
    supabase, tier4PoolIds, tier1to3Names, from, realDays,
  });
  formatDailyCalendar({ tier4Plan, from, log });

  if (dryRun) {
    log("\nDRY-RUN — ingen writes. Kør med --live EFTER ejer-godkendelse.");
    return {
      deleted: 0, dryRun: true, toReverse, toDeleteScheduled, reversals, illegalCount: illegalIds.size,
      restOfSeasonWindow: { from: from.toISOString(), seasonEnd: seasonEnd.toISOString(), realDays }, tier4Plan,
    };
  }

  const { data: flagRow, error: flagErr } = await supabase
    .from("app_config").select("value").eq("key", STAGE_SCHEDULER_FLAG_KEY).maybeSingle();
  if (flagErr) throw new Error(`app_config (${STAGE_SCHEDULER_FLAG_KEY}): ${flagErr.message}`);
  const flagBefore = flagRow?.value ?? null;
  const setFlag = async (value) => {
    const { error } = await supabase.from("app_config").upsert({ key: STAGE_SCHEDULER_FLAG_KEY, value }, { onConflict: "key" });
    if (error) throw new Error(`app_config upsert: ${error.message}`);
  };
  await setFlag("off");
  log(`scheduler-flag '${STAGE_SCHEDULER_FLAG_KEY}' sat til 'off' (var: ${JSON.stringify(flagBefore)})`);
  try {

  // 1) Backup (JSON) — ALLE tier 4-løb + CHILD_TABLES + finance_transactions for de afviklede.
  const backup = {
    generated_at: now.toISOString(), season_id: season.id,
    races: tier4Races || [], illegalReasons: illegalRaces, financeTransactions: financeTx, children: {},
  };
  for (const table of CHILD_TABLES) {
    backup.children[table] = [];
    for (let i = 0; i < raceIdsToDelete.length; i += 100) {
      backup.children[table].push(...await fetchAll(supabase, table, (q) => q.in("race_id", raceIdsToDelete.slice(i, i + 100))));
    }
  }
  const backupDir = join(dirname(fileURLToPath(import.meta.url)), "backups");
  mkdirSync(backupDir, { recursive: true });
  const backupPath = join(backupDir, `repair-2276-div4-cascade-${now.toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(backupPath, JSON.stringify(backup));
  log(`backup skrevet: ${backupPath}`);

  // 2) Finance-reversering FØR sletning (idempotent — race_prize_reversal:<raceId>:<teamId>).
  let reversedCount = 0, reversedSkipped = 0;
  for (const rev of reversals) {
    const { skipped } = await incrementBalanceWithAudit(supabase, {
      teamId: rev.teamId,
      delta: rev.amount,
      payload: {
        // NB: finance_transactions_type_check (database/2026-07-05-facilities-staff-foundation.sql)
        // har INTET dedikeret 'prize_reversal'-type — genbruger 'admin_adjustment' (allerede
        // whitelisted) for korrektions-transaktioner. reason_code + description + idempotency_key
        // gør reverseringen entydigt sporbar i finance_transactions.
        type: "admin_adjustment",
        amount: rev.amount,
        description: `Reversering — fuld Div 4-nulstilling (#2276) — ${byId.get(rev.raceId)?.name ?? rev.raceId}`,
        season_id: season.id,
        race_id: rev.raceId,
        actor_type: FINANCE_ACTOR_TYPE.MIGRATION,
        source_path: "repair2276Div4Cascade.repairDiv4Cascade",
        reason_code: FINANCE_REASON.ADMIN_BALANCE_ADJUSTMENT,
        related_entity_type: FINANCE_RELATED_ENTITY.RACE,
        related_entity_id: rev.raceId,
        idempotency_key: rev.idempotencyKey,
      },
    }, { allowDuplicate: true });
    if (skipped) reversedSkipped++; else reversedCount++;
  }
  log(`  finance-reversering: ${reversedCount} udført, ${reversedSkipped} sprunget over (allerede reverseret — idempotent)`);

  // 3) Fatigue-nulstilling for ryttere med entries i de slettede løb.
  const affectedRiderIds = [...new Set(backup.children.race_entries.map((e) => e.rider_id).filter(Boolean))];
  for (let i = 0; i < affectedRiderIds.length; i += 200) {
    const { error } = await supabase
      .from("rider_condition").update({ fatigue: 0 }).in("rider_id", affectedRiderIds.slice(i, i + 200));
    if (error) throw new Error(`rider_condition fatigue-reset: ${error.message}`);
  }
  log(`  fatigue nulstillet for ${affectedRiderIds.length} berørte ryttere`);

  // 4) Slet børn → løb.
  for (const table of CHILD_TABLES) {
    const { error } = await supabase.from(table).delete().in("race_id", raceIdsToDelete);
    if (error) throw new Error(`delete ${table}: ${error.message}`);
    log(`  slettet ${backup.children[table].length} rækker fra ${table}`);
  }
  // finance_transactions.race_id er NO ACTION (audit-loggen SKAL overleve løbs-sletning) —
  // detach referencen før delete. Beløb + idempotency_key (indeholder race-id'et) +
  // related_entity_id bevarer det fulde audit-spor. Rammer både originaler og reverseringer.
  for (let i = 0; i < raceIdsToDelete.length; i += 100) {
    const slice = raceIdsToDelete.slice(i, i + 100);
    const { error: ftErr } = await supabase.from("finance_transactions")
      .update({ race_id: null }).in("race_id", slice);
    if (ftErr) throw new Error(`detach finance_transactions.race_id: ${ftErr.message}`);
  }
  log(`  finance_transactions.race_id detached (audit-rækker bevaret)`);
  const { error: delErr } = await supabase.from("races").delete().in("id", raceIdsToDelete);
  if (delErr) throw new Error(`delete races: ${delErr.message}`);
  log(`  slettet ${raceIdsToDelete.length} løb`);

  // 5) Rider-værdier (prize_earnings_bonus) + standings + matviews + season-race-days.
  await updateRiderValues(supabase);
  log("  rytterværdier genberegnet (prize_earnings_bonus)");
  await updateStandings(season.id, null, { supabase });
  log("  season_standings genberegnet");
  await refreshRankingMatviewsSafe(supabase);
  log("  rangliste-matviews refreshet");
  await recomputeSeasonRaceDays({ supabase, seasonId: season.id });
  log("  season race-days genberegnet");

  // 6) Re-materialisér tier 4 med den rettede materializer (whitelist + cross-tier-dedup) +
  // #2276-ejer-override (tæthed 3, forkortet vindue) — SAMME `from`/`realDays` som dry-run-
  // preview'en ovenfor viste ejeren, beregnet FØR sletningen (lowerTierPoolIds er uberørte).
  if (realDays < 1) throw new Error("sæsonen er ved at slutte — ingen re-materialisering");

  const summary = await materializeTierCalendars({
    supabase, seasonId: season.id, seasonStartDate: season.start_date, from,
    tiers: [4], forceTiers: [4], dryRun: false, realDays,
    quotas: { ...TIER_GAME_DAY_QUOTA, 4: DIV4_REPAIR_DENSITY * realDays },
    density: { ...TIER_DENSITY, 4: DIV4_REPAIR_DENSITY },
    log,
  });
  log(`\nre-materialiseret: +${summary.racesInserted} løb, ${summary.stageSchedules} etape-tider`);
  return {
    deleted: raceIdsToDelete.length, backupPath, affectedRiders: affectedRiderIds.length,
    reversedCount, reversedSkipped, ...summary,
  };

  } finally {
    if (flagBefore != null) {
      await setFlag(flagBefore);
      log(`scheduler-flag genoprettet til ${JSON.stringify(flagBefore)}`);
    }
  }
}

if (process.argv[1] && process.argv[1].endsWith("repair2276Div4Cascade.js")) {
  const __envdir = dirname(fileURLToPath(import.meta.url));
  dotenv.config({ path: join(__envdir, "../.env"), quiet: true });   // backend/.env
  dotenv.config({ path: join(__envdir, "../../.env"), quiet: true }); // repo-root fallback
  const dryRun = !process.argv.includes("--live");
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  repairDiv4Cascade({ supabase, dryRun })
    .then((res) => { console.log("\nfærdig:", JSON.stringify({ deleted: res.deleted, dryRun: !!res.dryRun })); })
    .catch((err) => { console.error("FEJL:", err.message); process.exit(1); });
}
