// Reparation #4485 — ungdomsklassement (young/young_day) i afsluttede S3-etapeløb
// brugte forkert referenceår (seasons.start_date i stedet for seasons.number) OG
// den gamle "< 25"-U25-cutoff. Begge er rettet i koden (backend/lib/raceRunner.js,
// PR #4593 for cutoff'et). Dette script retter de HISTORISKE `race_results`-rækker
// der blev skrevet under de gamle bugs, målt i:
//   docs/audits/4485-genberegning-forslag-2026-09-04.md (fuld metode + tal)
//
// Ejer-beslutning 4/9 på #4485: U25 = 25 og yngre (bekræftet), penge rettes BEGGE
// veje (Option B) — hold der fik en forkert præmie får den trukket tilbage, hold
// der fik for lidt får differencen efterbetalt. INGEN direkte UPDATE teams.balance:
// begge retninger går via den eksisterende audit-sti (incrementBalanceWithAudit/
// debitTeam, samme RPC som paySeasonPrizesToDate bruger).
//
// GENBRUGER (ingen ny kopi af nogen af disse):
//   - isU25ForReferenceYear/seasonReferenceYear (riderSeasonAge.js — SSOT for U25)
//   - buildRacePointsLookup (raceResultsEngine.js — samme point-tabel-opslag som raceRunner)
//   - PRIZE_PER_POINT (economyConstants.js)
//   - updateStandings (economyEngine.js — den EKSISTERENDE season_standings-recompute,
//     kaldt fra raceRunner efter hvert løb. Scriptet skriver ALDRIG selv til
//     season_standings — det sker udelukkende via dette kald, efter race_results
//     er rettet, så standings altid er en ren afledning af de rettede rækker.)
//   - debitTeam / incrementBalanceWithAudit (balanceRpc.js + economyEngine.js —
//     samme atomiske balance+finance_transactions-sti som al anden præmieudbetaling)
//   - fetchAllRows/fetchAllRowsChunkedIn (supabasePagination.js)
//
// RÆKKEFØLGE (rang → point → penge → standings), ÉT logisk kald, idempotent:
//   1) RANG:  race_results.young/young_day for de berørte løb slettes og genopbygges
//             fra de URØRTE gc/leader-rækker, filtreret til fødselsår >= referenceår-25.
//   2) POINT: points_earned sættes fra race_points (samme tabel motoren bruger).
//   3) PENGE: prize_money = points_earned * PRIZE_PER_POINT. Nettoforskellen pr. hold
//             udbetales/trækkes via debitTeam/incrementBalanceWithAudit — ALDRIG en
//             direkte balance-UPDATE.
//   4) STANDINGS: updateStandings(seasonId) kaldes til sidst, så season_standings
//             genafledes fra de nu rettede race_results (samme funktion raceRunner
//             selv bruger — ingen hjemmestrikket kopi).
//
// IDEMPOTENT:
//   - Trin 1-3 er en ren funktion af gc/leader (som scriptet ALDRIG rører) → en
//     gentagen kørsel genfinder PRÆCIS samme korrekte rækker, diff'en mod den
//     allerede rettede young/young_day bliver tom, og der skrives 0 nye rækker.
//   - Trin 3's idempotency_key (`repair-4485:<credit|clawback>:<team_id>`) gør et
//     gentaget kald til incrementBalanceWithAudit til et no-op (23505 → skipped).
//   - Trin 4 (updateStandings) er i forvejen idempotent (fuld re-derivation).
//
// NEGATIV SALDO: hvis en tilbagebetaling ville sende et holds balance under 0,
// STOPPER scriptet HELE apply-kørslen FØR nogen skrivning og rapporterer holdet —
// ejeren afgør (ingen automatisk negativ saldo, ingen delvis kørsel).
//
// KØR ALDRIG mod prod uden ejer-godkendelse (givet 4/9 for selve reparationen,
// men --apply kræver stadig eksplicit bekræftelse ved hver kørsel):
//   node backend/scripts/repair-4485-young-classification.js
//       → dry-run (DEFAULT): fuld rapport, read-only. Intet skrives.
//   node backend/scripts/repair-4485-young-classification.js --apply --confirm "REPAIR 4485 YOUNG CLASSIFICATION"
//       → RIGTIG kørsel. Kræver DESUDEN REPAIR_4485_OWNER_ACK=true i miljøet.
//         Backup skrives FØR enhver ændring (backup_4485_*-tabellerne, DDL i
//         database/2026-09-04-4485-young-classification-backup-tables.sql).
//         Post-verify køres til sidst; scriptet exit(1) hvis der er rester.

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

import { isU25ForReferenceYear, seasonReferenceYear } from "../lib/riderSeasonAge.js";
import { buildRacePointsLookup } from "../lib/raceResultsEngine.js";
import { PRIZE_PER_POINT, FINANCE_ACTOR_TYPE, FINANCE_RELATED_ENTITY } from "../lib/economyConstants.js";
import { updateStandings, debitTeam } from "../lib/economyEngine.js";
import { incrementBalanceWithAudit } from "../lib/balanceRpc.js";
import { fetchAllRows, fetchAllRowsChunkedIn } from "../lib/supabasePagination.js";

export const SEASON_3_ID = "00000000-0000-0000-0000-000000000003";
export const BACKUP_RACE_RESULTS_TABLE = "backup_4485_race_results_20260904";
export const BACKUP_STANDINGS_TABLE = "backup_4485_season_standings_20260904";
export const BACKUP_TEAMS_TABLE = "backup_4485_teams_balance_20260904";

// ─── Rene funktioner (testbare uden DB, node --test) ───────────────────────────

/**
 * Filtrér et gc/leader-felt til reelt U25 (sæson-alder <= 25, ejer-beslutning
 * 2/9 + 4/9) og genranger 1..N pr. (race_id, stage_number), i SAMME relative
 * rækkefølge som det oprindelige `rank` (cumTime-rækkefølgen — urørt sportslig
 * facitliste). Matematisk identisk med motorens
 * `rankByCumTimeAsc(classified.filter(is_u25), cumTime, posSum)`, fordi filtrering
 * bevarer relativ orden.
 *
 * @param {Array<{race_id, stage_number, rider_id, rank, team_id, team_name}>} baseRows
 * @param {Map<string, {birthdate: string}>} riderById
 * @param {number} referenceYear
 * @returns {Array<{race_id, stage_number, rider_id, rank, team_id, team_name}>}
 */
export function rerankU25Field(baseRows, riderById, referenceYear) {
  const groups = new Map();
  for (const row of baseRows) {
    const key = `${row.race_id}::${row.stage_number}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const out = [];
  for (const rows of groups.values()) {
    const sorted = [...rows].sort((a, b) => a.rank - b.rank);
    const eligible = sorted.filter((row) => {
      const rider = riderById.get(row.rider_id);
      return rider && isU25ForReferenceYear(rider.birthdate, referenceYear);
    });
    eligible.forEach((row, index) => {
      out.push({
        race_id: row.race_id,
        stage_number: row.stage_number,
        rider_id: row.rider_id,
        rank: index + 1,
        team_id: row.team_id ?? null,
        team_name: row.team_name ?? null,
      });
    });
  }
  return out;
}

/**
 * Vedhæfter rider_name + points_earned/prize_money til hver reranked række,
 * via SAMME point-tabel-opslag som motoren (buildRacePointsLookup).
 *
 * @param {Array<{race_id, stage_number, rider_id, rank, team_id, team_name}>} rows
 * @param {"young"|"young_day"} resultType
 * @param {Map<string,string>} raceClassByRaceId
 * @param {Map<string, object>} pointsLookupByRaceClass  race_class -> buildRacePointsLookup-resultat
 * @param {Map<string, {firstname, lastname}>} riderById
 * @returns {Array<object>} fulde race_results-rækker (uden id/entrant_key — DB genererer)
 */
export function withPointsAndPrize(rows, resultType, raceClassByRaceId, pointsLookupByRaceClass, riderById) {
  return rows.map((row) => {
    const raceClass = raceClassByRaceId.get(row.race_id);
    const lookup = pointsLookupByRaceClass.get(raceClass) || {};
    const points = lookup[`${resultType}__${row.rank}`] || 0;
    const rider = riderById.get(row.rider_id);
    const riderName = rider ? [rider.firstname, rider.lastname].filter(Boolean).join(" ") || null : null;
    return {
      race_id: row.race_id,
      stage_number: row.stage_number,
      result_type: resultType,
      rank: row.rank,
      rider_id: row.rider_id,
      rider_name: riderName,
      team_id: row.team_id,
      team_name: row.team_name,
      points_earned: points,
      prize_money: points * PRIZE_PER_POINT,
    };
  });
}

/**
 * Netto point/CZ$-forskel pr. hold: sum(nye rækker) - sum(gamle rækker), grupperet
 * på team_id. Bruger row.team_id (frosset løbstidspunkt-snapshot, #1993-mønster),
 * ALDRIG rider.team_id (som kan have ændret sig siden løbet).
 *
 * @param {Array<object>} oldRows  eksisterende young/young_day-rækker (points_earned, prize_money, team_id)
 * @param {Array<object>} newRows  korrigerede rækker (samme form)
 * @returns {Map<string, {oldPoints:number,newPoints:number,oldPrize:number,newPrize:number,pointsDelta:number,czDelta:number}>}
 */
export function diffByTeam(oldRows, newRows) {
  const byTeam = new Map();
  const bump = (teamId, side, points, prize) => {
    if (!teamId) return;
    if (!byTeam.has(teamId)) {
      byTeam.set(teamId, { oldPoints: 0, newPoints: 0, oldPrize: 0, newPrize: 0 });
    }
    const entry = byTeam.get(teamId);
    entry[`${side}Points`] += points || 0;
    entry[`${side}Prize`] += prize || 0;
  };
  for (const row of oldRows) bump(row.team_id, "old", row.points_earned, row.prize_money);
  for (const row of newRows) bump(row.team_id, "new", row.points_earned, row.prize_money);
  for (const entry of byTeam.values()) {
    entry.pointsDelta = entry.newPoints - entry.oldPoints;
    entry.czDelta = entry.newPrize - entry.oldPrize;
  }
  return byTeam;
}

/**
 * Poolnøgle for standings-projektion — SAMME logik som economyEngine.updateStandings's
 * legacy-fallback (poolKeyOf): pulje hvis allokeret, ellers tier-bred gruppering.
 */
export function standingsPoolKey(row) {
  return row.league_division_id != null ? `pool:${row.league_division_id}` : `tier:${row.division || 3}`;
}

/**
 * Projicerer den FORVENTEDE season_standings-effekt UDEN at skrive noget — samme
 * rangordningsformel som economyEngine.updateStandings's legacy-fallback
 * (effective = total_points - penalty_points, faldende, pulje-lokal rang).
 * Kun til dry-run-rapportering; selve apply kalder den RIGTIGE updateStandings-RPC,
 * som er autoritativ (denne projektion kan afvige marginalt hvis RPC'en har en
 * anden tie-break — flages i rapporten som "PROJEKTION, ikke autoritativ").
 *
 * @param {Array<object>} standingsRows  aktuelle season_standings-rækker (samme sæson)
 * @param {Map<string, {pointsDelta:number}>} teamDeltaById
 * @returns {Array<{team_id, division, league_division_id, old_total_points, new_total_points,
 *   old_rank_in_division, new_rank_in_division, rank_changed}>}
 */
export function projectStandings(standingsRows, teamDeltaById) {
  const withNewPoints = standingsRows.map((row) => {
    const delta = teamDeltaById.get(row.team_id)?.pointsDelta || 0;
    return { ...row, new_total_points: (row.total_points || 0) + delta };
  });

  const pools = new Map();
  for (const row of withNewPoints) {
    const key = standingsPoolKey(row);
    if (!pools.has(key)) pools.set(key, []);
    pools.get(key).push(row);
  }

  const newRankByTeamId = new Map();
  for (const rows of pools.values()) {
    const ranked = [...rows].sort((a, b) => {
      const aEff = (a.new_total_points || 0) - (a.penalty_points || 0);
      const bEff = (b.new_total_points || 0) - (b.penalty_points || 0);
      return bEff - aEff;
    });
    ranked.forEach((row, index) => newRankByTeamId.set(row.team_id, index + 1));
  }

  return withNewPoints
    .filter((row) => teamDeltaById.has(row.team_id) && teamDeltaById.get(row.team_id).pointsDelta !== 0)
    .map((row) => {
      const newRank = newRankByTeamId.get(row.team_id) ?? row.rank_in_division;
      return {
        team_id: row.team_id,
        division: row.division,
        league_division_id: row.league_division_id,
        old_total_points: row.total_points,
        new_total_points: row.new_total_points,
        old_rank_in_division: row.rank_in_division,
        new_rank_in_division: newRank,
        rank_changed: newRank !== row.rank_in_division,
      };
    });
}

/**
 * Hold der ville gå under 0 CZ$ hvis netto-CZ$-deltaet (kan være negativt =
 * tilbagebetaling) trækkes fra deres NUVÆRENDE balance. Bruges til at STOPPE
 * apply FØR enhver skrivning — ejeren afgør, scriptet gætter ikke.
 *
 * @param {Array<{id, balance}>} teams
 * @param {Map<string, {czDelta:number}>} teamDeltaById
 * @returns {Array<{team_id, balance, czDelta, projectedBalance}>}
 */
export function findNegativeBalanceRisk(teams, teamDeltaById) {
  const risks = [];
  for (const team of teams) {
    const delta = teamDeltaById.get(team.id)?.czDelta || 0;
    if (delta >= 0) continue; // kun tilbagebetalinger (negativt delta) kan skabe negativ saldo
    const projected = (team.balance || 0) + delta;
    if (projected < 0) {
      risks.push({ team_id: team.id, balance: team.balance || 0, czDelta: delta, projectedBalance: projected });
    }
  }
  return risks;
}

// ─── Orkestrering (DB injiceres — testbar uden createClient) ───────────────────

async function loadRaceContext(supabase, seasonId) {
  const races = await fetchAllRows(() => (
    supabase
      .from("races")
      .select("id, name, race_class, stages")
      .eq("season_id", seasonId)
      .eq("status", "completed")
      .eq("race_type", "stage_race")
      .order("id", { ascending: true })
  ));
  const raceIds = races.map((r) => r.id);
  const raceClassByRaceId = new Map(races.map((r) => [r.id, r.race_class]));
  const raceById = new Map(races.map((r) => [r.id, r]));

  const resultRows = raceIds.length
    ? await fetchAllRowsChunkedIn(raceIds, (chunk) => (
        supabase
          .from("race_results")
          .select("id, race_id, stage_number, result_type, rank, rider_id, team_id, team_name, points_earned, prize_money")
          .in("race_id", chunk)
          .in("result_type", ["gc", "leader", "young", "young_day"])
          .order("id", { ascending: true })
      ))
    : [];

  const gcRows = resultRows.filter((r) => r.result_type === "gc");
  const leaderRows = resultRows.filter((r) => r.result_type === "leader");
  const oldYoungRows = resultRows.filter((r) => r.result_type === "young");
  const oldYoungDayRows = resultRows.filter((r) => r.result_type === "young_day");

  const riderIds = [...new Set(resultRows.map((r) => r.rider_id).filter(Boolean))];
  const riderRows = riderIds.length
    ? await fetchAllRowsChunkedIn(riderIds, (chunk) => (
        supabase.from("riders").select("id, firstname, lastname, birthdate").in("id", chunk).order("id", { ascending: true })
      ))
    : [];
  const riderById = new Map(riderRows.map((r) => [r.id, r]));

  const raceClasses = [...new Set(races.map((r) => r.race_class).filter(Boolean))];
  const pointsLookupByRaceClass = new Map();
  if (raceClasses.length) {
    const pointsRows = await fetchAllRowsChunkedIn(raceClasses, (chunk) => (
      supabase.from("race_points").select("race_class, result_type, rank, points").in("race_class", chunk).order("race_class", { ascending: true })
    ));
    for (const raceClass of raceClasses) {
      const racePoints = pointsRows.filter((p) => p.race_class === raceClass);
      pointsLookupByRaceClass.set(raceClass, buildRacePointsLookup({ racePoints, raceType: "stage_race" }));
    }
  }

  return {
    races, raceById, raceClassByRaceId,
    gcRows, leaderRows, oldYoungRows, oldYoungDayRows,
    riderById, pointsLookupByRaceClass,
  };
}

function toRaceResultRow(row, resultType) {
  return { race_id: row.race_id, stage_number: row.stage_number ?? 1, result_type: resultType, rank: row.rank, rider_id: row.rider_id, team_id: row.team_id ?? null, team_name: row.team_name ?? null };
}

/**
 * Bygger den fulde reparationsplan (rang→point→penge→standings-projektion) uden
 * at skrive noget. Bruges af BÅDE dry-run og apply (apply genbruger PRÆCIS samme
 * plan som lige er rapporteret — ingen "second guess" mellem rapport og skrivning).
 */
export async function buildRepairPlan({ supabase, seasonId = SEASON_3_ID, _log = () => {} }) {
  const { data: season, error: seasonErr } = await supabase.from("seasons").select("id, number").eq("id", seasonId).maybeSingle();
  if (seasonErr) throw new Error(`seasons: ${seasonErr.message}`);
  if (!season) throw new Error(`sæson ${seasonId} findes ikke`);
  const referenceYear = seasonReferenceYear(season.number);

  const ctx = await loadRaceContext(supabase, seasonId);

  const correctedYoungBase = rerankU25Field(
    ctx.gcRows.map((r) => toRaceResultRow(r, "gc")), ctx.riderById, referenceYear
  );
  const correctedYoungDayBase = rerankU25Field(
    ctx.leaderRows.map((r) => toRaceResultRow(r, "leader")), ctx.riderById, referenceYear
  );

  const correctedYoung = withPointsAndPrize(correctedYoungBase, "young", ctx.raceClassByRaceId, ctx.pointsLookupByRaceClass, ctx.riderById);
  const correctedYoungDay = withPointsAndPrize(correctedYoungDayBase, "young_day", ctx.raceClassByRaceId, ctx.pointsLookupByRaceClass, ctx.riderById);

  const oldAll = [...ctx.oldYoungRows, ...ctx.oldYoungDayRows];
  const newAll = [...correctedYoung, ...correctedYoungDay];
  const teamDeltaById = diffByTeam(oldAll, newAll);

  // Kun hold med et FAKTISK nul-forskelligt delta skal have en transaktion.
  const teamsToPay = [...teamDeltaById.entries()].filter(([, d]) => d.pointsDelta !== 0 || d.czDelta !== 0);

  // Per-løb-rapport (young top-3 + young_day rang-1 der skifter), til dry-run-visning.
  const byRaceYoungTop3 = [];
  const oldYoungByRace = new Map();
  for (const row of ctx.oldYoungRows) {
    if (!oldYoungByRace.has(row.race_id)) oldYoungByRace.set(row.race_id, []);
    oldYoungByRace.get(row.race_id).push(row);
  }
  const newYoungByRace = new Map();
  for (const row of correctedYoung) {
    if (!newYoungByRace.has(row.race_id)) newYoungByRace.set(row.race_id, []);
    newYoungByRace.get(row.race_id).push(row);
  }
  for (const race of ctx.races) {
    const oldTop3 = (oldYoungByRace.get(race.id) || []).filter((r) => r.rank <= 3).sort((a, b) => a.rank - b.rank);
    const newTop3 = (newYoungByRace.get(race.id) || []).filter((r) => r.rank <= 3).sort((a, b) => a.rank - b.rank);
    const changed = oldTop3.some((o, i) => newTop3[i]?.rider_id !== o.rider_id) || oldTop3.length !== newTop3.length;
    if (changed) {
      byRaceYoungTop3.push({ race_id: race.id, race_name: race.name, oldTop3, newTop3 });
    }
  }

  return { season, referenceYear, ctx, correctedYoung, correctedYoungDay, teamDeltaById, teamsToPay, byRaceYoungTop3 };
}

/**
 * Kører reparationen. dryRun (default true): kun rapport, intet skrevet.
 * apply=true: backup → delete+insert race_results → penge (debit/kredit) →
 * updateStandings → post-verify. Stopper FØR enhver skrivning hvis en
 * tilbagebetaling ville sende et hold under 0 CZ$.
 */
export async function runRepair({ supabase, seasonId = SEASON_3_ID, dryRun = true, log = console.log }) {
  const plan = await buildRepairPlan({ supabase, seasonId, log });

  const { data: standingsRows, error: standingsErr } = await supabase
    .from("season_standings").select("team_id, division, league_division_id, total_points, penalty_points, rank_in_division").eq("season_id", seasonId);
  if (standingsErr) throw new Error(`season_standings: ${standingsErr.message}`);
  const standingsProjection = projectStandings(standingsRows || [], plan.teamDeltaById);

  const teamIds = plan.teamsToPay.map(([teamId]) => teamId);
  const teamRows = teamIds.length
    ? await fetchAllRowsChunkedIn(teamIds, (chunk) => (
        supabase.from("teams").select("id, name, is_ai, balance").in("id", chunk).order("id", { ascending: true })
      ))
    : [];
  const teamById = new Map(teamRows.map((t) => [t.id, t]));
  const negativeRisk = findNegativeBalanceRisk(teamRows, plan.teamDeltaById);

  const report = {
    dryRun,
    seasonId,
    referenceYear: plan.referenceYear,
    racesScanned: plan.ctx.races.length,
    youngRowsBefore: plan.ctx.oldYoungRows.length,
    youngRowsAfter: plan.correctedYoung.length,
    youngDayRowsBefore: plan.ctx.oldYoungDayRows.length,
    youngDayRowsAfter: plan.correctedYoungDay.length,
    racesWithTop3Change: plan.byRaceYoungTop3.length,
    byRaceYoungTop3: plan.byRaceYoungTop3,
    teamsAffected: plan.teamsToPay.length,
    teamTotals: plan.teamsToPay.map(([teamId, d]) => ({
      team_id: teamId,
      team_name: teamById.get(teamId)?.name ?? null,
      is_ai: teamById.get(teamId)?.is_ai ?? null,
      balance: teamById.get(teamId)?.balance ?? null,
      pointsDelta: d.pointsDelta,
      czDelta: d.czDelta,
    })),
    totalPointsDelta: plan.teamsToPay.reduce((s, [, d]) => s + Math.abs(d.pointsDelta), 0) / 2,
    totalCzOwed: plan.teamsToPay.reduce((s, [, d]) => s + Math.max(d.czDelta, 0), 0),
    totalCzClawback: plan.teamsToPay.reduce((s, [, d]) => s + Math.max(-d.czDelta, 0), 0),
    standingsProjection,
    negativeBalanceRisk: negativeRisk,
  };

  if (dryRun) {
    log(`[4485] DRY-RUN — ${report.racesScanned} løb scannet, ${report.teamsAffected} hold ramt, intet skrevet.`);
    return report;
  }

  if (negativeRisk.length) {
    log(`[4485] APPLY STOPPET — ${negativeRisk.length} hold ville gå under 0 CZ$. Ingen skrivning foretaget. Ejeren skal afgøre disse hold først.`);
    report.aborted = true;
    report.abortReason = "negative_balance_risk";
    return report;
  }

  // ── Trin 0: BACKUP FØR SKRIVNING ──────────────────────────────────────────
  const allOldRows = [...plan.ctx.oldYoungRows, ...plan.ctx.oldYoungDayRows];
  if (allOldRows.length) {
    const backupRows = allOldRows.map((r) => ({ ...r, captured_at: new Date().toISOString() }));
    const { error: backupErr } = await supabase.from(BACKUP_RACE_RESULTS_TABLE).upsert(backupRows, { onConflict: "id" });
    if (backupErr) throw new Error(`backup race_results: ${backupErr.message}`);
  }
  if (standingsRows?.length) {
    const standingsBackup = standingsRows.map((r) => ({ ...r, season_id: seasonId, captured_at: new Date().toISOString() }));
    const { error: backupStandingsErr } = await supabase.from(BACKUP_STANDINGS_TABLE).upsert(standingsBackup, { onConflict: "season_id,team_id" });
    if (backupStandingsErr) throw new Error(`backup season_standings: ${backupStandingsErr.message}`);
  }
  if (teamRows.length) {
    const teamsBackup = teamRows.map((t) => ({ team_id: t.id, balance_before: t.balance, captured_at: new Date().toISOString() }));
    const { error: backupTeamsErr } = await supabase.from(BACKUP_TEAMS_TABLE).upsert(teamsBackup, { onConflict: "team_id" });
    if (backupTeamsErr) throw new Error(`backup teams: ${backupTeamsErr.message}`);
  }

  // ── Trin 1+2 (RANG + POINT — indsættes sammen, points er allerede udledt): ──
  const oldIds = allOldRows.map((r) => r.id);
  if (oldIds.length) {
    const { error: delErr } = await fetchDeleteChunked(supabase, oldIds);
    if (delErr) throw new Error(`delete young/young_day: ${delErr.message}`);
  }
  const newRows = [...plan.correctedYoung, ...plan.correctedYoungDay];
  for (let i = 0; i < newRows.length; i += 500) {
    const chunk = newRows.slice(i, i + 500);
    const { error: insErr } = await supabase.from("race_results").insert(chunk);
    if (insErr) throw new Error(`insert corrected young/young_day: ${insErr.message}`);
  }

  // ── Trin 3: PENGE — begge veje, via den eksisterende audit-sti ──────────────
  for (const [teamId, delta] of plan.teamsToPay) {
    if (delta.czDelta === 0) continue;
    const amount = Math.abs(delta.czDelta);
    if (delta.czDelta > 0) {
      await incrementBalanceWithAudit(supabase, {
        teamId,
        delta: amount,
        payload: {
          type: "admin_adjustment",
          amount,
          description: "Reparation #4485 — efterbetaling, korrekt U25-klassificering (young/young_day)",
          season_id: seasonId,
          actor_type: FINANCE_ACTOR_TYPE.MIGRATION,
          related_entity_type: FINANCE_RELATED_ENTITY.SEASON,
          related_entity_id: seasonId,
          source_path: "repair-4485-young-classification.runRepair",
          reason_code: "race_prize_correction_credit",
          idempotency_key: `repair-4485:credit:${teamId}`,
        },
      }, { allowDuplicate: true });
    } else {
      await debitTeam(
        teamId, amount, "admin_adjustment",
        "Reparation #4485 — tilbageførsel, forkert U25-klassificering (young/young_day)",
        seasonId, supabase,
        {
          idempotent: true,
          audit: {
            actorType: FINANCE_ACTOR_TYPE.MIGRATION,
            relatedEntityType: FINANCE_RELATED_ENTITY.SEASON,
            relatedEntityId: seasonId,
            sourcePath: "repair-4485-young-classification.runRepair",
            reasonCode: "race_prize_correction_clawback",
            idempotencyKey: `repair-4485:clawback:${teamId}`,
          },
        }
      );
    }
  }

  // ── Trin 4: STANDINGS — genafled fra de nu rettede race_results ─────────────
  const standingsResult = await updateStandings(seasonId, null, { supabase });

  // ── Post-verify ──────────────────────────────────────────────────────────
  const postVerify = await buildRepairPlan({ supabase, seasonId, log });
  const remainingWrong = postVerify.teamsToPay.length;

  report.applied = true;
  report.standingsResult = standingsResult;
  report.postVerifyRemainingTeams = remainingWrong;
  if (remainingWrong > 0) {
    log(`[4485] ADVARSEL: post-verify finder stadig ${remainingWrong} hold med et delta > 0 efter apply.`);
  } else {
    log(`[4485] APPLY færdig — 0 hold tilbage med forkert klassificering.`);
  }
  return report;
}

async function fetchDeleteChunked(supabase, ids) {
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const { error } = await supabase.from("race_results").delete().in("id", chunk);
    if (error) return { error };
  }
  return { error: null };
}

// ─── CLI ────────────────────────────────────────────────────────────────────

if (process.argv[1] && process.argv[1].endsWith("repair-4485-young-classification.js")) {
  const __envdir = dirname(fileURLToPath(import.meta.url));
  dotenv.config({ path: join(__envdir, "../.env"), quiet: true });
  dotenv.config({ path: join(__envdir, "../../.env"), quiet: true });

  const argValue = (name) => {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : null;
  };
  const APPLY = process.argv.includes("--apply");
  const CONFIRM = argValue("--confirm");
  const REQUIRED_CONFIRM = "REPAIR 4485 YOUNG CLASSIFICATION";
  const OWNER_ACK = process.env.REPAIR_4485_OWNER_ACK === "true";

  if (APPLY && (CONFIRM !== REQUIRED_CONFIRM || !OWNER_ACK)) {
    console.error(`FEJL: --apply kraever BAADE --confirm "${REQUIRED_CONFIRM}" OG REPAIR_4485_OWNER_ACK=true i miljoeet. Ingen writes udfoert.`);
    process.exit(1);
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error("FEJL: Mangler SUPABASE_URL eller SUPABASE_SERVICE_KEY (infisical run --env=prod -- node backend/scripts/repair-4485-young-classification.js ...)");
    process.exit(1);
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const dryRun = !APPLY;
  console.log(`=== #4485 young/young_day-reparation — ${dryRun ? "DRY-RUN" : "APPLY"} ===`);
  runRepair({ supabase, dryRun })
    .then((report) => {
      console.log(JSON.stringify(report, null, 2));
      if (!report.dryRun && (report.aborted || report.postVerifyRemainingTeams > 0)) process.exitCode = 1;
    })
    .catch((err) => { console.error("FEJL:", err.message); process.exit(1); });
}
