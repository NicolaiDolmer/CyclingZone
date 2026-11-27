// #8604 Trend-prognosen: batchen, der forbereder prognoserne uden for anmodningen.
//
// Beregningen bor i prognosisTrend8604.js (ren). Her: læs, opsummer, regn, publicer
// idempotent pr. (rytter, hold). Samme input giver samme hash, og så skrives intet.
// Bag kontakten prognosis_trend_8604 (seedet "off"): slukket læses kun kontakten.
// Hard rule 17: begrundelser for konstanterne ligger i balance-internals/.

import { createHash } from "node:crypto";

import { readDevelopmentXpFromDate } from "./developmentXpFlag.ts";
import { REGISTRY_ABILITY_KEYS } from "./abilityRegistry.js";
import { VISIBLE_ABILITIES } from "./abilityDerivation.js";
import { ageForSeason } from "./riderSeasonAge.js";
import { copenhagenDateString, copenhagenHour } from "./copenhagenTime.js";
import { fetchAllRows, fetchAllRowsChunkedIn } from "./supabasePagination.js";
import { captureException } from "./sentry.js";
import { privateConfigHash } from "./privateConfig.ts";
import { loadEstimateDevelopmentXp, loadEstimateTeamIds } from "./potentialEstimateWriter.js";
import {
  PROGNOSIS_TREND_TABLE, PROGNOSIS_TREND_VERSION, TREND_OWN_AFTER_DATES, TREND_RECENT_DAYS,
  clamp, computeTrendPrognosis, daysBetween, isPrognosisTrendEnabled, priorFactorFromSamples,
  seasonHistoryPace, settledXpDates, standardPriorPace, trendPace,
} from "./prognosisTrend8604.js";

// Den daglige fulde kørsel starter fra denne time (Europe/Copenhagen), efter nattens afregning.
export const TREND_DAILY_FROM_HOUR = 5;

// ── Batch: forbered prognoserne uden for anmodningen ─────────────────────────────

const ABILITY_COLUMNS = `rider_id, ability_progress, ${REGISTRY_ABILITY_KEYS.join(", ")}`;

function inputHash(parts) {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 32);
}

const roundPace = (pace) => (pace
  ? Object.fromEntries(Object.entries(pace).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, Math.round(v * 1000) / 1000]))
  : null);

/** Standard-I/O mod Supabase. Testene giver deres egen. */
export function supabaseTrendIo(supabase) {
  return {
    async activeSeason() {
      const { data, error } = await supabase.from("seasons")
        .select("id, number, race_days_completed, race_days_total").eq("status", "active").maybeSingle();
      if (error) throw new Error(`seasons: ${error.message}`);
      return data ?? null;
    },
    seasons: () => fetchAllRows(() => supabase.from("seasons")
      .select("id, number, status, start_date, end_date").order("number")),
    xpFromDate: () => readDevelopmentXpFromDate(supabase),
    teamIds: () => loadEstimateTeamIds(supabase),
    riders: (teamId) => fetchAllRows(() => supabase.from("riders")
      .select("id, team_id, birthdate, primary_type, secondary_type, potentiale, is_retired")
      .eq("team_id", teamId).order("id")),
    abilities: (riderIds) => fetchAllRowsChunkedIn(riderIds, (chunk) => supabase.from("rider_derived_abilities")
      .select(ABILITY_COLUMNS).in("rider_id", chunk).order("rider_id")),
    // Hele karrieren på XP-systemet, på alle hold, kun afregnede felter og kun de felter, farten bruger.
    ticks: (riderIds, since) => fetchAllRowsChunkedIn(riderIds, (chunk) => supabase.from("training_rider_ticks")
      .select("rider_id, team_id, season_id, game_day, tick_date, xp:report->xp, injured:report->injured, illness:report->illness_days")
      .in("rider_id", chunk).not("settled_at", "is", null).gte("tick_date", since)
      .order("rider_id").order("season_id").order("game_day").order("tick_date")),
    history: (riderIds, fromSeason, toSeason) => fetchAllRowsChunkedIn(riderIds, (chunk) => supabase.from("rider_derived_ability_history")
      .select("rider_id, snapshot_date, season_number, source, abilities").in("rider_id", chunk)
      .gte("season_number", fromSeason).lt("season_number", toSeason)
      .order("rider_id").order("snapshot_date").order("source")),
    published: (teamId) => fetchAllRows(() => supabase.from(PROGNOSIS_TREND_TABLE)
      .select("rider_id, input_hash").eq("team_id", teamId).order("rider_id")),
    async upsert(rows) {
      for (let i = 0; i < rows.length; i += 500) {
        const { error } = await supabase.from(PROGNOSIS_TREND_TABLE).upsert(rows.slice(i, i + 500), { onConflict: "rider_id,team_id" });
        if (error) throw new Error(`${PROGNOSIS_TREND_TABLE} upsert: ${error.message}`);
      }
    },
    async remove(teamId, riderIds) {
      if (!riderIds.length) return;
      const { error } = await supabase.from(PROGNOSIS_TREND_TABLE).delete().eq("team_id", teamId).in("rider_id", riderIds);
      if (error) throw new Error(`${PROGNOSIS_TREND_TABLE} delete: ${error.message}`);
    },
  };
}

/**
 * Første trin for ét hold: læs og opsummer rytterne (farten, datoerne, historikken), uden
 * at skrive. Opsummeringen er lille, så hele kørslen kan måle "normal træning" på tværs af
 * hold, før noget skrives.
 */
export async function summarizeTeam({ io, teamId, season, seasons, params, today, since, onlyMissing = false }) {
  const riders = (await io.riders(teamId)).filter((rider) => rider.is_retired !== true);
  const published = new Map((await io.published(teamId)).map((row) => [row.rider_id, row.input_hash]));
  const gone = [...published.keys()].filter((id) => !riders.some((rider) => rider.id === id));
  const wanted = onlyMissing ? riders.filter((rider) => !published.has(rider.id)) : riders;
  if (!wanted.length) return { teamId, published, gone, riders: [] };
  const ids = wanted.map((rider) => rider.id);
  const [abilityRows, ticks] = await Promise.all([io.abilities(ids), io.ticks(ids, since)]);
  const seasonNumberById = new Map(seasons.map((row) => [row.id, Number(row.number)]));
  const abilitiesBy = new Map(abilityRows.map((row) => [row.rider_id, row]));
  const ticksBy = new Map();
  for (const tick of ticks) {
    if (!ticksBy.has(tick.rider_id)) ticksBy.set(tick.rider_id, []);
    ticksBy.get(tick.rider_id).push(tick);
  }
  const summaries = wanted.map((rider) => {
    const dates = settledXpDates(ticksBy.get(rider.id), { seasonNumberById, birthdate: rider.birthdate });
    const riderInput = {
      id: rider.id, potentiale: rider.potentiale, birthdate: rider.birthdate,
      primaryType: rider.primary_type ?? null, secondaryType: rider.secondary_type ?? null,
    };
    const recentDates = dates.filter((entry) => daysBetween(entry.date, today) < TREND_RECENT_DAYS).length;
    return {
      rider: riderInput,
      abilities: abilitiesBy.get(rider.id) ?? null,
      dates,
      trend: dates.length ? trendPace(dates, { today, params }) : null,
      standard: standardPriorPace(riderInput, params),
      recentDates,
      history: null,
    };
  });
  // Egen historik (C) kun for ryttere, hvor farten endnu ikke er helt hans egen.
  const thin = summaries.filter((s) => s.dates.length < TREND_OWN_AFTER_DATES);
  if (thin.length && io.history) {
    const current = Number(season.number);
    const rows = await io.history(thin.map((s) => s.rider.id), current - 2, current);
    const byRider = new Map();
    for (const row of rows) {
      if (!byRider.has(row.rider_id)) byRider.set(row.rider_id, []);
      byRider.get(row.rider_id).push(row);
    }
    for (const s of thin) {
      s.history = seasonHistoryPace({
        snapshots: byRider.get(s.rider.id) ?? [], seasons, birthdate: s.rider.birthdate, currentSeasonNumber: current,
      }, params);
    }
  }
  return { teamId, published, gone, riders: summaries };
}

/** Andet trin for ét hold: regn og publicer idempotent. Returnerer tællingen. */
export async function publishTeam({ io, summary, season, params, factor, today, now, onlyMissing = false }) {
  const counts = { riders: summary.riders.length, written: 0, unchanged: 0, skipped: 0, removed: onlyMissing ? 0 : summary.gone.length };
  if (!onlyMissing) await io.remove(summary.teamId, summary.gone);
  const seasonProgress = Number(season.race_days_total) > 0
    ? clamp(Number(season.race_days_completed) / Number(season.race_days_total), 0, 1) : 0;
  const paramsVersion = privateConfigHash(params);
  const rows = [];
  for (const s of summary.riders) {
    const seasonAge = ageForSeason(s.rider.birthdate, Number(season.number));
    if (!s.abilities || seasonAge == null) { counts.skipped += 1; continue; }
    const visible = Object.fromEntries(VISIBLE_ABILITIES.map((ability) => [ability, s.abilities[ability] ?? null]));
    const bars = s.abilities.ability_progress ?? null;
    const hash = inputHash([
      PROGNOSIS_TREND_VERSION, paramsVersion, s.rider.id, summary.teamId, seasonAge, Math.round(seasonProgress * 1000),
      s.rider.primaryType, s.rider.secondaryType, visible, bars, roundPace(s.trend), roundPace(s.history),
      Math.round(factor * 1000), s.dates.length, s.dates.filter((entry) => entry.teams.includes(summary.teamId)).length,
      s.dates.length ? s.dates.at(-1).date : null, s.recentDates,
    ]);
    if (summary.published.get(s.rider.id) === hash) { counts.unchanged += 1; continue; }
    const result = computeTrendPrognosis({
      rider: { ...s.rider, abilities: visible, bars },
      dates: s.dates, teamId: summary.teamId, history: s.history, factor, today, seasonAge, seasonProgress,
    }, params);
    // En rytters fremtid er ren CPU: giv event-loopet fri mellem rytterne, så batchen aldrig
    // holder anmodninger hen.
    await new Promise((resolve) => setImmediate(resolve));
    if (!result) { counts.skipped += 1; continue; }
    rows.push({
      rider_id: s.rider.id, team_id: summary.teamId, value: result.value, learning: result.learning,
      horizon: result.horizon, own_dates: Math.min(32767, result.ownDates), model_version: PROGNOSIS_TREND_VERSION,
      input_hash: hash, computed_at: now.toISOString(),
    });
  }
  await io.upsert(rows);
  counts.written = rows.length;
  return counts;
}

const processState = { fullRunDate: null, factor: null };

/**
 * Batchen. Daglig fuld kørsel fra TREND_DAILY_FROM_HOUR, ellers kun ryttere uden række, så en
 * ny rytter får sin prognose inden for en time. Kontakt slukket = intet læses ud over kontakten.
 * Ét hold, der fejler, vælter ikke resten.
 */
export async function runPrognosisTrendBatch({ supabase, now = new Date(), io = null, state = processState, log = console }) {
  if (!(await isPrognosisTrendEnabled(supabase))) return { ran: false, skipped: "flag_off" };
  const params = await loadEstimateDevelopmentXp(supabase, { now, log });
  if (!params) return { ran: false, skipped: "xp_off" };
  const dataIo = io ?? supabaseTrendIo(supabase);
  const [season, seasons, since] = await Promise.all([dataIo.activeSeason(), dataIo.seasons(), dataIo.xpFromDate()]);
  if (!season?.id || !Number.isFinite(Number(season.number))) return { ran: false, skipped: "no_season" };
  if (!since) return { ran: false, skipped: "xp_off" };
  const today = copenhagenDateString(now);
  const full = state.fullRunDate !== today && copenhagenHour(now) >= TREND_DAILY_FROM_HOUR;
  const totals = { teams: 0, riders: 0, written: 0, unchanged: 0, skipped: 0, removed: 0 };
  let failedTeams = 0;
  let firstError = null;
  const fail = (teamId, err) => {
    // best-effort: holdet tages igen ved næste kørsel; ét samlet Sentry-event pr. kørsel.
    failedTeams += 1;
    firstError ??= err.message;
    log?.error?.(`  prognosis trend failed for team ${teamId}: ${err.message}`);
  };
  const summaries = [];
  for (const teamId of await dataIo.teamIds()) {
    try {
      summaries.push(await summarizeTeam({ io: dataIo, teamId, season, seasons, params, today, since, onlyMissing: !full }));
    } catch (err) {
      // best-effort: holdet tages igen ved næste kørsel; fail() samler ét Sentry-event pr. kørsel.
      fail(teamId, err);
    }
  }
  // Den fulde kørsel måler "normal træning" på alle ryttere; timekørslen genbruger målingen.
  const factor = full || state.factor == null
    ? priorFactorFromSamples(summaries.flatMap((summary) => summary.riders))
    : state.factor;
  for (const summary of summaries) {
    try {
      const counts = await publishTeam({ io: dataIo, summary, season, params, factor, today, now, onlyMissing: !full });
      totals.teams += 1;
      for (const key of Object.keys(counts)) totals[key] += counts[key];
    } catch (err) {
      // best-effort: holdet tages igen ved næste kørsel; fail() samler ét Sentry-event pr. kørsel.
      fail(summary.teamId, err);
    }
  }
  if (full) state.factor = factor;
  if (full && !failedTeams) state.fullRunDate = today;
  return { ran: true, full, ...totals, failedTeams, ...(firstError ? { firstError } : {}) };
}

/** Cron-indgangen. */
export async function runPrognosisTrendTick({ supabase, now = new Date(), capture = captureException }) {
  const result = await runPrognosisTrendBatch({ supabase, now });
  if (result.ran && result.written > 0) {
    console.log(`Prognosis trend (${result.full ? "full" : "missing"}): ${result.teams} teams, ${result.written} written, ${result.unchanged} unchanged`);
  }
  if (result.failedTeams > 0) {
    capture(new Error(`prognosis-trend: ${result.failedTeams} teams failed: ${result.firstError}`), { tags: { cron: "prognosis-trend" } });
  }
  return result;
}

