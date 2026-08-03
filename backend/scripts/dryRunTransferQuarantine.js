#!/usr/bin/env node
// #2557 spor A · READ-ONLY dry-run af transfer-karantænen mod prod.
//
// Scriptet MUTERER INTET og kalder ALDRIG apply/UPDATE/INSERT. Det svarer på:
//   1. Hvor mange erhvervelser i det aktuelle transfervindue ville blive ramt
//      ved forskellige evne-marginer?
//   2. Hvilke ryttere/hold, og hvor mange af deres FAKTISKE starter, top-10 og
//      sejre lå på dage de ville have siddet over?
//   3. Hvor mange share4PlusSameTeamTop10-brud ville forsvinde (naiv
//      første-ordens optælling — ikke en re-simulering)?
//   4. Hvordan fordeler de ramte sig på erhvervelses-KILDE (fri agent vs. salg
//      fra en højere tier)? Det er datagrundlaget for om diskriminatoren skal
//      være evne-margin eller sælgerens tier.
//
// Usage:
//   node backend/scripts/dryRunTransferQuarantine.js
//   node backend/scripts/dryRunTransferQuarantine.js --json
//   node backend/scripts/dryRunTransferQuarantine.js --race-days 2,4,6,8
//   node backend/scripts/dryRunTransferQuarantine.js --margins 5,10,15,20
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY (service-role — kun SELECT bruges).

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  QUARANTINE_RIVAL_RANK,
  buildPoolRaceDays,
  isAcquisitionInTransferWindow,
  planTeamQuarantine,
  poolRivalPeak,
  riderPeak,
} from "../lib/transferQuarantine.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");
dotenv.config({ path: join(REPO_ROOT, "backend", ".env"), quiet: true });

const PAGE_SIZE = 1000;
// PostgREST koder .in()-listen i URL'en; ved sæson-skala (600+ race-UUID'er)
// rammer det proxy-grænsen og fejler som en rå "fetch failed". Samme chunk-
// størrelse som raceEntryGenerator.selectInChunks.
const IN_CHUNK_SIZE = 200;

async function fetchAll(buildQuery) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await buildQuery().range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) return rows;
  }
}

async function fetchAllIn(buildQuery, ids) {
  const rows = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK_SIZE) {
    rows.push(...await fetchAll(() => buildQuery(ids.slice(i, i + IN_CHUNK_SIZE))));
  }
  return rows;
}

function parseList(argv, flag, fallback) {
  const i = argv.indexOf(flag);
  if (i === -1 || !argv[i + 1]) return fallback;
  return argv[i + 1].split(",").map((n) => Number(n.trim())).filter(Number.isFinite);
}

async function main() {
  const argv = process.argv.slice(2);
  const asJson = argv.includes("--json");
  const raceDaysGrid = parseList(argv, "--race-days", [2, 4, 6, 8]);
  const marginGrid = parseList(argv, "--margins", [5, 10, 15, 20]);

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_KEY mangler");
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  // ── Aktiv sæson + kalender ──────────────────────────────────────────────────
  const { data: season, error: seasonErr } = await supabase
    .from("seasons").select("id, number, start_date").eq("status", "active")
    .order("number", { ascending: false }).limit(1).maybeSingle();
  if (seasonErr) throw new Error(`seasons: ${seasonErr.message}`);
  if (!season) throw new Error("ingen aktiv sæson");

  const races = await fetchAll(() => supabase
    .from("races").select("id, league_division_id, race_type, season_id")
    .eq("season_id", season.id).order("id"));
  const raceById = new Map(races.map((r) => [r.id, r]));

  const raceIds = races.map((r) => r.id);
  const schedule = await fetchAllIn((chunk) => supabase
    .from("race_stage_schedule").select("race_id, stage_number, scheduled_at, game_day")
    .in("race_id", chunk).order("race_id").order("stage_number"), raceIds);
  const poolRaceDaysByPool = buildPoolRaceDays(schedule, raceById);

  // Transfervinduets start = seneste etape FØR sæsonens første etape (forrige
  // sæsons sidste løbsdag). Samme regel som loadQuarantineState.
  let firstStageMs = Infinity;
  for (const days of poolRaceDaysByPool.values()) {
    if (days.length && days[0].startsAt < firstStageMs) firstStageMs = days[0].startsAt;
  }
  const { data: prevStage, error: prevErr } = await supabase
    .from("race_stage_schedule").select("scheduled_at")
    .lt("scheduled_at", new Date(firstStageMs).toISOString())
    .order("scheduled_at", { ascending: false }).limit(1).maybeSingle();
  if (prevErr) throw new Error(`race_stage_schedule (prev): ${prevErr.message}`);
  const windowStartsAt = prevStage?.scheduled_at
    ? new Date(prevStage.scheduled_at).getTime()
    : new Date(season.start_date).getTime();

  // ── Hold, puljer, ryttere, evner ────────────────────────────────────────────
  const pools = await fetchAll(() => supabase.from("league_divisions").select("id, tier, label").order("id"));
  const poolById = new Map(pools.map((p) => [p.id, p]));

  const teams = await fetchAll(() => supabase
    .from("teams").select("id, name, is_ai, is_bank, is_test_account, is_frozen, league_division_id").order("id"));
  // "Rigtige hold" = samme diskriminator som audit'en: ikke AI, ikke bank, ikke
  // testkonto, ikke frosset, og i en pulje.
  const realTeams = teams.filter((t) => !t.is_ai && !t.is_bank && !t.is_test_account && !t.is_frozen && t.league_division_id != null);
  const teamById = new Map(teams.map((t) => [t.id, t]));

  const riders = await fetchAll(() => supabase
    .from("riders").select("id, firstname, lastname, team_id, acquired_at, is_academy, is_retired")
    .not("team_id", "is", null).eq("is_academy", false).order("id"));
  const activeRiders = riders.filter((r) => r.is_retired !== true);

  const abilities = await fetchAll(() => supabase
    .from("rider_derived_abilities")
    .select("rider_id, flat, climbing, sprint, time_trial, punch, cobblestone").order("rider_id"));
  const peakByRider = new Map(abilities.map((a) => [a.rider_id, riderPeak(a)]));

  // Puljens rytterpopulation (ALLE hold i puljen, også AI — de kører i feltet).
  const poolRiders = new Map();
  for (const r of activeRiders) {
    const poolId = teamById.get(r.team_id)?.league_division_id;
    if (poolId == null) continue;
    if (!poolRiders.has(poolId)) poolRiders.set(poolId, []);
    poolRiders.get(poolId).push({ teamId: r.team_id, peak: peakByRider.get(r.id) ?? 0 });
  }
  const rivalPeakByTeam = new Map();
  for (const t of realTeams) {
    rivalPeakByTeam.set(t.id, poolRivalPeak(poolRiders.get(t.league_division_id) || [], t.id));
  }

  // ── Erhvervelser i vinduet ──────────────────────────────────────────────────
  const realTeamIds = new Set(realTeams.map((t) => t.id));
  const acquisitions = activeRiders
    .filter((r) => realTeamIds.has(r.team_id))
    .filter((r) => isAcquisitionInTransferWindow({ acquiredAt: r.acquired_at, windowStartsAt }))
    .map((r) => {
      const team = teamById.get(r.team_id);
      const peak = peakByRider.get(r.id) ?? 0;
      const rival = rivalPeakByTeam.get(r.team_id);
      return {
        riderId: r.id,
        rider: `${r.firstname} ${r.lastname}`,
        teamId: r.team_id,
        teamName: team?.name ?? null,
        poolId: team?.league_division_id ?? null,
        poolLabel: poolById.get(team?.league_division_id)?.label ?? null,
        tier: poolById.get(team?.league_division_id)?.tier ?? null,
        acquiredAt: r.acquired_at,
        peak,
        rivalPeak: rival,
        margin: rival === null || rival === undefined ? null : peak - rival,
      };
    });

  const marginCounts = marginGrid.map((m) => ({
    margin: m,
    riders: acquisitions.filter((a) => a.margin !== null && a.margin >= m).length,
    teams: new Set(acquisitions.filter((a) => a.margin !== null && a.margin >= m).map((a) => a.teamId)).size,
  }));

  // ── Faktiske dags-resultater for de ramte ───────────────────────────────────
  // Ét "start" = én etape (stage_race/result_type='stage') eller ét endagsløb
  // (single/result_type='gc') — samme grundenhed som share4PlusSameTeamTop10.
  const gameDayByRaceStage = new Map();
  for (const s of schedule) gameDayByRaceStage.set(`${s.race_id}|${s.stage_number}`, s.game_day);

  const results = await fetchAllIn((chunk) => supabase
    .from("race_results").select("race_id, stage_number, result_type, rider_id, team_id, rank")
    .in("race_id", chunk).order("id"), raceIds);
  const dayResults = results.filter((rr) => {
    const race = raceById.get(rr.race_id);
    if (!race || !rr.rider_id || !rr.team_id) return false;
    return (race.race_type === "stage_race" && rr.result_type === "stage")
      || (race.race_type === "single" && rr.result_type === "gc");
  }).map((rr) => ({ ...rr, game_day: gameDayByRaceStage.get(`${rr.race_id}|${rr.stage_number}`) }));

  const scenarios = [];
  for (const margin of marginGrid) {
    const triggered = acquisitions.filter((a) => a.margin !== null && a.margin >= margin);
    const byTeam = new Map();
    for (const a of triggered) {
      if (!byTeam.has(a.teamId)) byTeam.set(a.teamId, []);
      byTeam.get(a.teamId).push({ riderId: a.riderId, acquiredAt: a.acquiredAt });
    }
    for (const raceDays of raceDaysGrid) {
      const blockedDaysByRider = new Map();
      for (const [teamId, acqs] of byTeam) {
        const poolId = teamById.get(teamId)?.league_division_id;
        const plan = planTeamQuarantine({
          acquisitions: acqs,
          poolRaceDays: poolRaceDaysByPool.get(poolId) || [],
          raceDays,
          maxDebutsPerRaceDay: 0, // trappen måles separat; her isoleres selve karantænen
        });
        for (const [riderId, entry] of plan) blockedDaysByRider.set(riderId, new Set(entry.blockedGameDays));
      }

      let starts = 0, top10 = 0, wins = 0, blockedStarts = 0, blockedTop10 = 0, blockedWins = 0;
      for (const rr of dayResults) {
        const blockedDays = blockedDaysByRider.get(rr.rider_id);
        if (!blockedDays) continue;
        starts += 1;
        if (rr.rank <= 10) top10 += 1;
        if (rr.rank === 1) wins += 1;
        if (blockedDays.has(rr.game_day)) {
          blockedStarts += 1;
          if (rr.rank <= 10) blockedTop10 += 1;
          if (rr.rank === 1) blockedWins += 1;
        }
      }

      // Naiv første-ordens brud-optælling: hvor mange (etape, hold)-enheder med
      // 4+ i top 10 ville falde under 4 hvis de karantæneramte forsvandt?
      // ADVARSEL: dette er IKKE en re-simulering — i virkeligheden rykker andre
      // ryttere op i de tomme top-10-pladser, og de kan tilhøre samme hold.
      const unit = new Map(); // "race|stage|team" → {tier, total, blocked}
      for (const rr of dayResults) {
        if (rr.rank > 10) continue;
        const race = raceById.get(rr.race_id);
        const tier = poolById.get(race?.league_division_id)?.tier ?? null;
        const key = `${rr.race_id}|${rr.stage_number}|${rr.team_id}`;
        if (!unit.has(key)) unit.set(key, { tier, total: 0, blocked: 0 });
        const u = unit.get(key);
        u.total += 1;
        if (blockedDaysByRider.get(rr.rider_id)?.has(rr.game_day)) u.blocked += 1;
      }
      let breaches = 0, removed = 0, breachesT3 = 0, removedT3 = 0;
      for (const u of unit.values()) {
        if (u.total < 4) continue;
        breaches += 1;
        if (u.tier === 3) breachesT3 += 1;
        if (u.total - u.blocked < 4) {
          removed += 1;
          if (u.tier === 3) removedT3 += 1;
        }
      }

      scenarios.push({
        margin, raceDays,
        quarantinedRiders: triggered.length,
        quarantinedTeams: byTeam.size,
        starts, top10, wins,
        blockedStarts, blockedTop10, blockedWins,
        breaches, breachesRemovedNaive: removed,
        breachesTier3: breachesT3, breachesTier3RemovedNaive: removedT3,
      });
    }
  }

  const out = {
    season: { id: season.id, number: season.number, start_date: season.start_date },
    transferWindowStart: new Date(windowStartsAt).toISOString(),
    rivalRank: QUARANTINE_RIVAL_RANK,
    acquisitionsInWindow: acquisitions.length,
    teamsWithAcquisitions: new Set(acquisitions.map((a) => a.teamId)).size,
    marginCounts,
    scenarios,
    riders: acquisitions
      .filter((a) => a.margin !== null && a.margin >= Math.min(...marginGrid))
      .sort((a, b) => b.margin - a.margin),
  };

  if (asJson) {
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  console.log(`Sæson ${out.season.number} (${out.season.id})`);
  console.log(`Transfervindue åbnede: ${out.transferWindowStart} (forrige sæsons sidste etape)`);
  console.log(`Erhvervelser i vinduet: ${out.acquisitionsInWindow} fordelt på ${out.teamsWithAcquisitions} rigtige hold\n`);
  console.log("Ramte pr. margin (rytterens peak minus puljens 10.-bedste rival uden for eget hold):");
  for (const m of marginCounts) console.log(`  margin >= ${String(m.margin).padStart(2)}  ->  ${m.riders} ryttere / ${m.teams} hold`);
  console.log("\nScenarier (blokeret = faktiske resultater der lå på en karantæne-dag):");
  console.log("  margin  dage  ryttere  starter  top10  sejre | blok.start  blok.top10  blok.sejre | brud  fjernet(naivt)  brud-t3  fjernet-t3");
  for (const s of scenarios) {
    console.log(
      `  ${String(s.margin).padStart(6)}  ${String(s.raceDays).padStart(4)}  ${String(s.quarantinedRiders).padStart(7)}  `
      + `${String(s.starts).padStart(7)}  ${String(s.top10).padStart(5)}  ${String(s.wins).padStart(5)} | `
      + `${String(s.blockedStarts).padStart(10)}  ${String(s.blockedTop10).padStart(10)}  ${String(s.blockedWins).padStart(10)} | `
      + `${String(s.breaches).padStart(4)}  ${String(s.breachesRemovedNaive).padStart(14)}  ${String(s.breachesTier3).padStart(7)}  ${String(s.breachesTier3RemovedNaive).padStart(10)}`,
    );
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
