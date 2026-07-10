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
import { materializeTierCalendars, TIER_DENSITY } from "../lib/tierCalendarMaterializer.js";
import { TIER_GAME_DAY_QUOTA, TIER_CLASS_WHITELIST } from "../lib/tierRaceSelection.js";
import { classifyIllegalTier4Races, computeFinanceReversals } from "../lib/div4CascadeRepair.js";
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

  const { toDelete, canonicalTemplate } = classifyIllegalTier4Races({
    racesByPool, tier1to3Names, classWhitelist: TIER_CLASS_WHITELIST[4],
  });

  log(`\n── Live-tilstand: ${toDelete.length} ulovlig(e)/skæv(e) løb-instans(er) på tværs af ${tier4PoolIds.length} tier 4-puljer ──`);
  const byId = new Map((tier4Races || []).map((r) => [r.id, r]));
  const raceIdsToDelete = toDelete.map((d) => d.id);
  const playedIds = toDelete.filter((d) => byId.get(d.id)?.status === "completed" || byId.get(d.id)?.prize_paid_at).map((d) => d.id);

  for (const d of toDelete) {
    const { data: entryRows, error: entriesErr } = await supabase
      .from("race_entries").select("team_id").eq("race_id", d.id);
    if (entriesErr) throw new Error(`race_entries (${d.id}): ${entriesErr.message}`);
    const teamIds = [...new Set((entryRows || []).map((e) => e.team_id).filter(Boolean))];
    let realTeamCount = 0;
    if (teamIds.length) {
      const { data: teamRows, error: teamsErr } = await supabase
        .from("teams").select("id, is_ai").in("id", teamIds);
      if (teamsErr) throw new Error(`teams (${d.id}): ${teamsErr.message}`);
      realTeamCount = (teamRows || []).filter((t) => t.is_ai === false).length;
    }
    log(`  pulje ${d.pool_id} · ${d.name} · ${byId.get(d.id)?.status} · entries ${entryRows?.length ?? 0} (rigtige hold: ${realTeamCount}) · [${d.reasons.join(",")}] · ${d.id}`);
  }
  if (!toDelete.length) { log("intet at reparere"); return { deleted: 0 }; }

  log(`\n${playedIds.length} af de ulovlige løb er AFVIKLET og kræver finance-reversering.`);

  // Finance-reversering (dry-run beregner + rapporterer, --live udfører).
  const financeTx = playedIds.length
    ? await fetchAll(supabase, "finance_transactions", (q) => q.in("race_id", playedIds))
    : [];
  const reversals = computeFinanceReversals({ transactions: financeTx, raceIds: playedIds });
  if (reversals.length) {
    log(`\nFinance-reversering (${reversals.length} hold-linjer):`);
    for (const rev of reversals) {
      const name = await realManagerName(supabase, rev.teamId);
      log(`  hold ${name} (${rev.teamId}) · løb ${byId.get(rev.raceId)?.name} · tilbagefør ${rev.amount}`);
    }
  }

  // Ny korrekt skabelon (til dry-run-output — den ENDELIGE er den re-materialiserede plan).
  log(`\nNy skabelon (${canonicalTemplate.length} løb, kaskade-korrekte klasser [${TIER_CLASS_WHITELIST[4].join(", ")}]):`);
  for (const t of canonicalTemplate) log(`  ${t.name} · ${t.stages} etape(r) · game_day_start ${t.game_day_start}`);

  if (dryRun) {
    log("\nDRY-RUN — ingen writes. Kør med --live EFTER ejer-godkendelse.");
    return { deleted: 0, dryRun: true, toDelete, reversals, canonicalTemplate };
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

  // 1) Backup (JSON) — races + CHILD_TABLES + finance_transactions for de afviklede.
  const backup = {
    generated_at: now.toISOString(), season_id: season.id,
    races: (toDelete.map((d) => byId.get(d.id))), reasons: toDelete, financeTransactions: financeTx, children: {},
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
        description: `Reversering — ulovligt løb i tier 4 (#2276) — ${byId.get(rev.raceId)?.name ?? rev.raceId}`,
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

  // 6) Re-materialisér tier 4 med den rettede materializer (whitelist + cross-tier-dedup).
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const seasonRaces = await fetchAll(supabase, "races", (q) => q.eq("season_id", season.id));
  const seasonRaceIds = seasonRaces.map((r) => r.id);
  let maxAt = null;
  for (let i = 0; i < seasonRaceIds.length; i += 200) {
    const { data: sched, error } = await supabase
      .from("race_stage_schedule").select("scheduled_at").in("race_id", seasonRaceIds.slice(i, i + 200));
    if (error) throw new Error(`race_stage_schedule (horisont): ${error.message}`);
    for (const s of sched || []) {
      const t = Date.parse(s.scheduled_at);
      if (Number.isFinite(t) && (maxAt == null || t > maxAt)) maxAt = t;
    }
  }
  if (maxAt == null) throw new Error("kunne ikke bestemme sæson-slut");
  const end = new Date(maxAt);
  const endDayUtc = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  const realDays = Math.floor((endDayUtc - from.getTime()) / 86_400_000);
  if (realDays < 1) throw new Error("sæsonen er ved at slutte — ingen re-materialisering");

  const summary = await materializeTierCalendars({
    supabase, seasonId: season.id, seasonStartDate: season.start_date, from,
    tiers: [4], dryRun: false, realDays,
    quotas: { ...TIER_GAME_DAY_QUOTA, 4: TIER_DENSITY[4] * realDays },
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
