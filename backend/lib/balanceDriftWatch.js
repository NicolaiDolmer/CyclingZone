// Balance-drift-vagt (#2414) — I/O-adapter + cron-entrypoint.
//
// Natligt job: beregner GÅRSDAGENS (UTC-kalenderdag) dominans/varians-metrikker
// fra ÆGTE prod-resultater (race_results + race_simulation_runs +
// race_simulation_rider_scores + race_incidents), klassificerer dem mod de
// kanoniske bånd (balanceDriftMetrics.js — kopieret fra simulateSeasonDryRun.js's
// DOMINANCE_TARGETS + raceDryRunOracles.js's DEFAULT_INCIDENT_TARGETS), persisterer
// én række i race_balance_drift_daily (admin-tabellen/trenden læser DERFRA — ingen
// genberegning nødvendig ved side-load) og sender en Discord-alarm hvis et bånd har
// været rødt i 3+ på hinanden følgende dage (#2397: ingen alarm på enkeltdage).
//
// READ-ONLY mod prod: INGEN insert/update/delete på race_results/race_simulation_*/
// race_incidents — kun SELECT. Den eneste skrivning er upsert til den NYE
// race_balance_drift_daily-tabel (dette jobs egen tilstand).
//
// Ren beregning (computeDayMetrics/classifyDay/findConsecutiveBreaches) er adskilt
// i balanceDriftMetrics.js så kernen er 100% unit-testbar uden supabase-mock
// (samme mønster som stallWatchdog.js's evaluateStallFindings/fetchWatchdogState-split).

import { fetchAllRows } from "./supabasePagination.js";
import {
  computeDayMetrics,
  classifyDay,
  findConsecutiveBreaches,
  evaluateBreachAlert,
  foldRiderWindowRows,
  computeTierBreakdown,
  BALANCE_DRIFT_TUNING,
} from "./balanceDriftMetrics.js";
import { withOpsMention } from "./opsWebhook.js";

const ENGINE_VERSION_V3 = 2; // #2414: race_simulation_runs.engine_version=2 er den DB-interne værdi for "race v3" (flippet 12/7 — se seneste engine_version-skift i prod).
const ROLLING_WINDOW_DAYS = 14;
const BALANCE_DRIFT_ALERT_KEY = "balance-drift-breach"; // #2730: nøgle i ops_alert_state for edge-triggered dedup

function dayBoundsUtc(dateStr) {
  const start = `${dateStr}T00:00:00.000Z`;
  const endDate = new Date(Date.parse(start) + 86_400_000);
  return { start, end: endDate.toISOString() };
}

function toDateStr(d) {
  return d.toISOString().slice(0, 10);
}

/**
 * Hent alle rå rækker for ÉN UTC-kalenderdag og fold dem til computeDayMetrics()-
 * inputtet. Ren I/O — ingen klassifikation/bånd-logik her.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} dateStr  YYYY-MM-DD (UTC-kalenderdag)
 * @returns {Promise<Parameters<typeof computeDayMetrics>[0]>}
 */
export async function fetchDayInputs(supabase, dateStr) {
  const { start, end } = dayBoundsUtc(dateStr);

  const runs = await fetchAllRows(() =>
    supabase
      .from("race_simulation_runs")
      .select("id, race_id, stage_number, entrant_snapshot, created_at")
      .eq("engine_version", ENGINE_VERSION_V3)
      .gte("created_at", start)
      .lt("created_at", end)
      .order("id")
  );

  if (runs.length === 0) {
    return {
      observations: [], incidentObservations: [],
      winsByRider: new Map(), startsByRider: new Map(),
      jourSansHits: 0, riderStageCount: 0, breakawayWins: 0, breakawayEligibleStages: 0,
      skippedNullRiderRows: 0,
    };
  }

  const runIds = runs.map((r) => r.id);
  const runById = new Map(runs.map((r) => [r.id, r]));
  const stageKeySet = new Set(runs.map((r) => `${r.race_id}:${r.stage_number}`));
  const raceIds = [...new Set(runs.map((r) => r.race_id))];

  const scores = await fetchAllRows(() =>
    supabase
      .from("race_simulation_rider_scores")
      .select("run_id, rider_id, rank, components")
      .in("run_id", runIds)
      .order("run_id")
  );

  // team_id kommer fra race_results (ikke persisteret i rider_scores) — hentet
  // for de samme (race_id, stage_number)-par som dagens runs, resultattype 'stage'.
  const dayResults = await fetchAllRows(() =>
    supabase
      .from("race_results")
      .select("race_id, stage_number, rider_id, team_id, rank, in_breakaway")
      .eq("result_type", "stage")
      .in("race_id", raceIds)
      .order("race_id")
  );

  // #2557: tier pr. etape, så dagens metrikker også kan brydes ned pr. tier.
  // Aggregatet skjulte i 3 uger at tier 3 var for forudsigelig mens tier 1/2/4
  // var for tilfældig — se computeTierBreakdown()'s header. races.league_division_id
  // → league_divisions.tier; ukendt/NULL ⇒ tier null (grupperes som "unknown",
  // aldrig gættet).
  const raceRows = await fetchAllRows(() =>
    supabase.from("races").select("id, league_division_id").in("id", raceIds).order("id")
  );
  const divisionRows = await fetchAllRows(() =>
    supabase.from("league_divisions").select("id, tier").order("id")
  );
  const tierByPoolId = new Map((divisionRows || []).map((d) => [d.id, d.tier]));
  const tierByRaceId = new Map(
    (raceRows || []).map((r) => [r.id, tierByPoolId.get(r.league_division_id) ?? null])
  );

  const teamByKey = new Map(); // `${race_id}:${stage_number}:${rider_id}` -> team_id|null
  const winnerBreakawayByStage = new Map(); // `${race_id}:${stage_number}` -> boolean (rank=1 in_breakaway)
  for (const r of dayResults) {
    const stageKey = `${r.race_id}:${r.stage_number}`;
    if (!stageKeySet.has(stageKey)) continue; // #1844-agtig sikkerhed: kun dagens etaper
    teamByKey.set(`${stageKey}:${r.rider_id}`, r.team_id ?? null);
    if (r.rank === 1) winnerBreakawayByStage.set(stageKey, !!r.in_breakaway);
  }

  // ── observations (favorit-win/podium/hold-koncentration) ──────────────────
  const scoresByRun = new Map();
  for (const s of scores) {
    if (!scoresByRun.has(s.run_id)) scoresByRun.set(s.run_id, []);
    scoresByRun.get(s.run_id).push(s);
  }

  const observations = [];
  let jourSansHits = 0;
  let riderStageCount = 0;
  for (const [runId, runScores] of scoresByRun.entries()) {
    const run = runById.get(runId);
    if (!run) continue;
    const stageKey = `${run.race_id}:${run.stage_number}`;
    const ranked = runScores.map((s) => ({
      rider_id: s.rider_id,
      rank: s.rank,
      team_id: teamByKey.get(`${stageKey}:${s.rider_id}`) ?? null,
      components: s.components || {},
    }));
    // observeRace importeres bevidst IKKE her — vi bygger kun input-formatet;
    // balanceDriftWatchOrchestrate (nedenfor) kalder den pure lib.
    observations.push({
      ranked,
      terrain: undefined,
      __stageKey: stageKey,
      tier: tierByRaceId.get(run.race_id) ?? null, // #2557
    });

    for (const s of runScores) {
      riderStageCount++;
      const jourSans = s.components?.jour_sans;
      if (typeof jourSans === "number" && jourSans < 0) jourSansHits++;
    }
  }

  // ── incidents ────────────────────────────────────────────────────────────
  const incidents = await fetchAllRows(() =>
    supabase
      .from("race_incidents")
      .select("race_id, stage_number, outcome")
      .in("race_id", raceIds)
      .order("race_id")
  );
  const incidentsByStage = new Map();
  for (const i of incidents) {
    const stageKey = `${i.race_id}:${i.stage_number}`;
    if (!stageKeySet.has(stageKey)) continue;
    if (!incidentsByStage.has(stageKey)) incidentsByStage.set(stageKey, []);
    incidentsByStage.get(stageKey).push(i);
  }

  const incidentObservationsInput = [];
  for (const run of runs) {
    const stageKey = `${run.race_id}:${run.stage_number}`;
    const fieldSize = Array.isArray(run.entrant_snapshot) ? run.entrant_snapshot.length : 0;
    incidentObservationsInput.push({
      incidents: incidentsByStage.get(stageKey) || [],
      fieldSize,
    });
  }

  // ── breakaway-sejre ─────────────────────────────────────────────────────
  let breakawayWins = 0;
  let breakawayEligibleStages = 0;
  for (const stageKey of stageKeySet) {
    if (!winnerBreakawayByStage.has(stageKey)) continue;
    breakawayEligibleStages++;
    if (winnerBreakawayByStage.get(stageKey)) breakawayWins++;
  }

  // ── 14-dages rullende win-rate pr. rytter (maxRiderWinRate) ────────────────
  const windowStart = new Date(Date.parse(start) - (ROLLING_WINDOW_DAYS - 1) * 86_400_000).toISOString();
  const windowRows = await fetchAllRows(() =>
    supabase
      .from("race_results")
      .select("rider_id, rank")
      .eq("result_type", "stage")
      .gte("imported_at", windowStart)
      .lt("imported_at", end)
      .order("rider_id")
  );
  // #2731: NULL-rider_id-værnet ligger i den pure lib (unit-testbar uden
  // supabase-mock, samme mønster som resten af filen).
  const { winsByRider, startsByRider, skippedNullRiderRows } = foldRiderWindowRows(windowRows);

  return {
    observations,
    incidentObservationsInput,
    winsByRider,
    startsByRider,
    jourSansHits,
    riderStageCount,
    breakawayWins,
    breakawayEligibleStages,
    skippedNullRiderRows,
  };
}

/**
 * Kør ÉN nats balance-drift-vagt: beregn i går, persistér, tjek 3-dages-alarm.
 * Read-only mod prod bortset fra upsert i race_balance_drift_daily.
 *
 * @param {object} args
 * @param {import("@supabase/supabase-js").SupabaseClient} args.supabase
 * @param {Date} [args.now]
 * @param {(url:string, payload:object) => Promise<any>} [args.sendWebhookFn]
 * @param {() => Promise<string|null>} [args.getOpsWebhookFn]
 * @param {(err:Error, ctx:object) => void} [args.captureExceptionFn]
 * @returns {Promise<{date:string, metrics:object, statuses:object, breaches:Array}>}
 */
export async function runBalanceDriftWatch({
  supabase,
  now = new Date(),
  sendWebhookFn,
  getOpsWebhookFn,
  captureExceptionFn,
} = {}) {
  // "I går" (UTC) — dagen jobbet kører for er altid FÆRDIG-simuleret ved 24h-tick.
  const targetDate = toDateStr(new Date(now.getTime() - 86_400_000));

  const inputs = await fetchDayInputs(supabase, targetDate);

  // observeRace importeres her (ikke i fetchDayInputs) for at holde I/O-funktionen
  // fri af den pure lib's beslutningslogik-overflade — kosmetisk adskillelse,
  // begge lever i samme fil da de deler samme kald-kontekst.
  const { observeRace, observeIncidents } = await import("./raceDominanceMetrics.js");
  // #2557: bær `tier` med over på observationen så nedbrydningen kan grupperes.
  // observeRace ignorerer ukendte felter, så tier'en påvirker ikke aggregatet.
  const observations = inputs.observations.map((o) => ({
    ...observeRace({ ranked: o.ranked, terrain: o.terrain }),
    tier: o.tier ?? null,
  }));
  const incidentObservations = inputs.incidentObservationsInput.map((o) => observeIncidents(o));

  const metrics = computeDayMetrics({
    observations,
    incidentObservations,
    winsByRider: inputs.winsByRider,
    startsByRider: inputs.startsByRider,
    jourSansHits: inputs.jourSansHits,
    riderStageCount: inputs.riderStageCount,
    breakawayWins: inputs.breakawayWins,
    breakawayEligibleStages: inputs.breakawayEligibleStages,
  });
  // #2731: pooling af dags-raterne kræver de seneste PERSISTEREDE rækker FØR
  // klassifikationen (ingen ekstra prod-læsning — dette kald erstatter det
  // tidligere post-upsert-fetch, som kun hentede `statuses`). Fejler den, falder
  // klassifikationen tilbage til ren dags-linse og streaken springes over.
  const { data: priorRows, error: fetchErr } = await supabase
    .from("race_balance_drift_daily")
    .select("metric_date, metrics, statuses")
    .lt("metric_date", targetDate)
    .order("metric_date", { ascending: false })
    .limit(ROLLING_WINDOW_DAYS);
  if (fetchErr) {
    captureExceptionFn?.(new Error(`race_balance_drift_daily fetch: ${fetchErr.message}`), {
      tags: { cron: "balance-drift-watch" },
    });
  }
  const priorHistory = (priorRows || []).map((r) => ({
    date: r.metric_date,
    metrics: r.metrics || {},
    statuses: r.statuses || {},
  }));
  // Dagens række først — poolDailyRate sorterer selv, men historikken SKAL
  // indeholde i dag for at vinduet er POOL_WINDOW_DAYS langt og ikke -1.
  const history = [{ date: targetDate, metrics }, ...priorHistory];

  const statuses = classifyDay(metrics, { recentRows: history });

  // #2557: report-only nedbrydning. classifyDay itererer kun BALANCE_DRIFT_BANDS,
  // så en ekstra nøgle i metrics ændrer hverken status, alarm eller admin-tabellen
  // (BalanceDriftWatchSection renderer fra sin egen METRIC_LABELS-allowlist).
  metrics.byTier = computeTierBreakdown(observations);

  const { error: upsertError } = await supabase
    .from("race_balance_drift_daily")
    .upsert({ metric_date: targetDate, metrics, statuses, computed_at: new Date().toISOString() }, { onConflict: "metric_date" });
  if (upsertError) {
    captureExceptionFn?.(new Error(`race_balance_drift_daily upsert: ${upsertError.message}`), {
      tags: { cron: "balance-drift-watch" },
      extra: { targetDate },
    });
    // Uden en persisteret række i dag kan 3-dages-vinduet ikke evalueres pålideligt
    // (ville se ud som et hul → nulstiller streaks) — stop her i stedet for at
    // risikere en falsk "streak brudt"-tavshed.
    return { date: targetDate, metrics, statuses, breaches: [] };
  }

  // Uden historik kan 3-dages-vinduet ikke evalueres pålideligt (et hul ville se
  // ud som en brudt streak) — stop her frem for at risikere falsk tavshed.
  if (fetchErr) {
    return { date: targetDate, metrics, statuses, breaches: [] };
  }

  // #2731: når robust-mode er ON re-klassificeres de historiske rækker under
  // SAMME estimator som i dag, så streaken ikke blander to linser lige efter et
  // flag-flip. Rækker fra før denne kode mangler `maxRiderWinRateLb`; da falder
  // classifyDay tilbage til dags-værdien — streaken kan altså holde et gammelt
  // rødt maxRiderWinRate i op til 3 dage efter flippet. Bevidst: den fejler mod
  // at alarmere, ikke mod at tie.
  const rows = [
    { date: targetDate, statuses },
    ...priorHistory.map((r) => ({
      date: r.date,
      statuses: BALANCE_DRIFT_TUNING.ROBUST_ESTIMATORS
        ? classifyDay(r.metrics, { recentRows: history.filter((h) => h.date <= r.date) })
        : r.statuses,
    })),
  ];
  const breaches = findConsecutiveBreaches(rows, { minConsecutiveDays: 3 });

  // #2730: edge-triggered dedup — alarmér KUN når brud-sættet ÆNDRER sig, så en
  // boot-/restart-kørsel (24h-timeren nulstilles ved hver deploy) ikke re-spammer
  // Discord med et uændret vedvarende brud. Sidst-alarmerede signatur ligger i
  // ops_alert_state (persisteret, restart-robust), ikke in-memory (rod-årsagen).
  const { data: stateRow, error: stateErr } = await supabase
    .from("ops_alert_state")
    .select("signature")
    .eq("alert_key", BALANCE_DRIFT_ALERT_KEY)
    .maybeSingle();
  if (stateErr) {
    captureExceptionFn?.(new Error(`ops_alert_state read (balance-drift): ${stateErr.message}`), {
      tags: { cron: "balance-drift-watch" },
    });
    // Fail-safe: uden dedup-state kan vi ikke afgøre om bruddet er nyt. Vær STILLE
    // frem for at risikere gen-spam — et ægte nyt brud fanges ved næste tick når
    // læsningen virker igen (idempotent: den persisterede daglige række er skrevet).
    return { date: targetDate, metrics, statuses, breaches };
  }

  const { shouldAlert, signature, changed } = evaluateBreachAlert(breaches, stateRow?.signature ?? "");

  if (shouldAlert) {
    const url = getOpsWebhookFn ? await getOpsWebhookFn() : null;
    if (url && sendWebhookFn) {
      const payload = withOpsMention({
        embeds: [
          {
            title: `⚠️ Balance-drift-vagt: ${breaches.length} bånd-brud i 3+ dage`,
            description: `Race v3-kalibreringen har drevet uden for kanoniske bånd i mindst 3 på hinanden følgende dage (seneste målt: ${targetDate}). Read-only vagt — ingen automatisk handling.`,
            color: 0xf39c12,
            fields: breaches.map((b) => ({
              name: b.metric,
              value: `${b.days} dage i træk (siden ${b.since}) · seneste værdi ${metrics[b.metric]}`,
            })),
            timestamp: new Date().toISOString(),
          },
        ],
      });
      await sendWebhookFn(url, payload);
    }
  }

  // Persistér den nye signatur når den ændrede sig — BÅDE ved ny/ændret alarm og
  // når bruddet RYDDES (signature=""), så et fremtidigt identisk brud alarmerer igen.
  if (changed) {
    const { error: upsertStateErr } = await supabase.from("ops_alert_state").upsert(
      {
        alert_key: BALANCE_DRIFT_ALERT_KEY,
        signature,
        ...(shouldAlert ? { last_alerted_at: new Date().toISOString() } : {}),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "alert_key" }
    );
    if (upsertStateErr) {
      captureExceptionFn?.(new Error(`ops_alert_state upsert (balance-drift): ${upsertStateErr.message}`), {
        tags: { cron: "balance-drift-watch" },
      });
    }
  }

  return { date: targetDate, metrics, statuses, breaches };
}
