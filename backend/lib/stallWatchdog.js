/**
 * Stall-watchdog (#2077) — fanger TAVSE stalls i race-pipelinen.
 * =============================================================
 * 30/6-2/7-incidenten kørte tavst i ~44 timer: updateStandings fejlede uden at
 * KASTE (URL-længde-limit), så exception-capture i stage-scheduleren fangede intet.
 * Denne watchdog tjekker hver 30. min for tilstande der er "stuck" UDEN en throw:
 *
 *   (a) finalization-stall  : alle etaper kørt (stages_completed >= stages) men
 *       status != 'completed', og sidste resultat-import er > finalizeHours gammel.
 *   (b) etape-stall (PRÆCIS, pr. løb, #2251): en enkelt FORFALDEN etape (allerede
 *       filtreret til scheduled_at < now-stageHours ved SQL-cutoff i
 *       fetchWatchdogState) med et reelt startfelt (entries>0) og STADIG ingen
 *       resultater. Fyrer pr. løb — ikke aggregeret globalt — så én reelt hængende
 *       etape ikke drukner blandt due-etaper der bliver afviklet normalt. Tomme
 *       spøgelsesløb (bund-divisioner uden managere) tælles aldrig med.
 *   (b2) etape-gennemløb (globalt, INFO — ikke fejl, #2251): samme kø-betingelse som
 *       (b), MEN kun logget — alarmerer aldrig Discord/Sentry. Før #2251 var DETTE
 *       globale "ingen resultater importeret NOGET sted i >stageHours"-signal selve
 *       (b)-alarmen, hvilket fyrede hver nat mellem løbsdage uden ét ægte hang (7
 *       events/døgn, 0 reelle stalls) — det er nu nedgraderet til info/log.
 *   (c) prize-payout-stall  : completed løb med prize_paid_at NULL > prizeHours
 *       efter sidste resultat-import — KUN når auto_prize er tændt (ellers betales
 *       præmier manuelt og NULL er forventet → ingen alarm).
 *   (d) standings-lag       : season_standings.updated_at hænger > standingsHours
 *       bag race_results.imported_at (results importeret men standings ikke opdateret).
 *   (e) matview-refresh-stall: rangliste-matviewsene (rider_rankings_mv m.fl.) driver
 *       > matviewStaleHours bag race_results — dvs. refresh_ranking_matviews()-stien
 *       (finalization-hook + 10-min cron-fallback) er død, så /standings +
 *       /rider-rankings viser stale/langsomme tal UDEN exception (#2196 Del 2).
 *       Uafhængig af (d): matviews og season_standings opdateres ad SEPARATE stier.
 *
 * races har INGEN updated_at-kolonne (verificeret mod prod 2026-07-03) → (a) og (c)
 * forankres på max(race_results.imported_at) pr. løb, ikke på en race-row-timestamp.
 * Query-logikken er valideret 1:1 mod prod via execute_sql (alle checks baseline
 * rene: entries-filteret ekskluderer 16 tomme spøgelsesløb fra chronrebuild'en 28/6).
 *
 * Ren logik (evaluateStallFindings) er adskilt fra I/O (fetchWatchdogState) så
 * kernen er 100% unit-testbar uden supabase-mock. Alarmer dedup'es pr.
 * (check, løb, dag) så en vedvarende stall ikke spammer hvert 30. min.
 */

import { fetchAllRows } from "./supabasePagination.js";

export const STALL_WATCHDOG_DEFAULT_THRESHOLDS = {
  finalizeHours: 2,
  stageHours: 2,
  // #2251: stageHours (2t) er SQL-cutoff for dueStages + tærskel for det GLOBALE
  // (b2)-info-gennemløbssignal. stageAlarmHours (4t) er den højere tærskel selve
  // PR-LØB-ALARMEN (b) kræver: en løbsdags-klynge (empirisk 22 etaper forfalder
  // 18:00 dansk) drænes sundt af scheduleren over 1-2t og krydser kortvarigt 2t —
  // det er IKKE et hang. 4t ligger komfortabelt over normal klynge-dræning, men
  // fanger stadig et ægte enkelt-løbs-hang. Balancerer #2251's "præcis pr. løb"-
  // alarm mod klynge-støjen der eskalerede til Discord+Sentry (CYCLINGZONE-2G).
  stageAlarmHours: 4,
  prizeHours: 1,
  standingsHours: 1,
  // 0.5t = 30 min. Refresh-cron kører hvert 10. min (+ finalization-hook straks),
  // så et lag > 30 min = 3 missede/fejlede refreshes = klart død sti, ikke jitter.
  matviewStaleHours: 0.5,
};

const HOUR_MS = 60 * 60 * 1000;

function ageHours(now, iso) {
  if (!iso) return Infinity;
  return (now.getTime() - new Date(iso).getTime()) / HOUR_MS;
}

function round1(n) {
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : null;
}

function dayKey(now) {
  return now.toISOString().slice(0, 10);
}

const TYPE_LABELS = {
  finalize: "⛔ Finalization-stall",
  stage: "⏱️ Etape-stall",
  stage_throughput: "ℹ️ Etape-gennemløb",
  prize: "💰 Præmie-stall",
  standings: "📊 Standings-lag",
  matview: "🐢 Rangliste-matview-stall",
};

export function labelForType(type) {
  return TYPE_LABELS[type] || type;
}

/**
 * Dedup-nøgle: én alarm pr. (check, løb, dag). Standings er sæson-globalt.
 */
export function findingKey(finding, now) {
  const day = dayKey(now);
  // standings + stage_throughput + matview er GLOBALE (sæson-brede) signaler → dedup pr.
  // dag. finalize + prize + stage (#2251: nu PRÆCIS pr. løb) er pr. løb → dedup pr. (løb, dag).
  if (finding.type === "standings" || finding.type === "stage_throughput" || finding.type === "matview") {
    return `${finding.type}:${day}`;
  }
  return `${finding.type}:${finding.raceId}:${day}`;
}

/**
 * Pure evaluator. Tager allerede-hentede rows og returnerer findings-array.
 * Ingen I/O — fuldt unit-testbar med plain objekter.
 */
export function evaluateStallFindings({
  now = new Date(),
  thresholds = STALL_WATCHDOG_DEFAULT_THRESHOLDS,
  autoPrizeEnabled = false,
  finalizeCandidates = [], // [{ id, name }] — stages_completed>=stages && status!=completed
  prizeCandidates = [],    // [{ id, name }] — completed && prize_paid_at NULL
  lastResultByRace = {},   // { [raceId]: importedAtISO | null }
  dueStages = [],          // [{ race_id, race_name, stage_number, scheduled_at, has_results, has_entries }]
  standings = { maxStandingsUpdated: null, maxResultsImported: null },
  matviewHeartbeat = null, // ISO | null — sidste succesfulde refresh_ranking_matviews()
} = {}) {
  const t = { ...STALL_WATCHDOG_DEFAULT_THRESHOLDS, ...thresholds };
  const findings = [];

  // (a) finalization-stall
  for (const r of finalizeCandidates) {
    const age = ageHours(now, lastResultByRace[r.id] ?? null);
    if (age > t.finalizeHours) {
      findings.push({
        type: "finalize",
        raceId: r.id,
        raceName: r.name,
        ageHours: round1(age),
        detail: Number.isFinite(age)
          ? `Alle etaper kørt men status≠completed; sidste resultat ${Math.round(age)}t siden`
          : "Alle etaper kørt men status≠completed; ingen race_results fundet",
      });
    }
  }

  // (b) etape-stall — PRÆCIS, pr. løb (#2251). dueStages er allerede filtreret til
  // scheduled_at < now-stageHours (SQL-cutoff i fetchWatchdogState), så "har et reelt
  // startfelt OG stadig ingen resultater" ER i sig selv en genuint forfalden, hængende
  // etape — uafhængigt af hvad der sker i resten af sæsonen. Fyrer PR. LØB (raceId sat)
  // så dedup/Discord-fields matcher finalize/prize-mønsteret 1:1.
  const queuedWork = dueStages.filter((s) => s.has_entries && !s.has_results);
  for (const s of queuedWork) {
    const stageAge = ageHours(now, s.scheduled_at);
    // #2251: kun ALARM når etapen er forfalden ud over stageAlarmHours (4t). 2-4t
    // er normal klynge-dræning (18:00-klyngen: 22 etaper på én gang) — dækkes af
    // (b2)-info-signalet nedenfor, ikke en Discord/Sentry-alarm. Et løb der stadig
    // er tomt for resultater 4t+ efter forfald er derimod et ægte, actionabelt hang.
    if (stageAge <= t.stageAlarmHours) continue;
    findings.push({
      type: "stage",
      raceId: s.race_id,
      raceName: s.race_name,
      stageNumber: s.stage_number,
      ageHours: round1(stageAge),
      detail:
        `Etape ${s.stage_number} forfalden ${Number.isFinite(stageAge) ? Math.round(stageAge) + "t" : ""} ` +
        `siden m. startfelt, ingen resultater importeret`,
    });
  }

  // (b2) etape-gennemløb (GLOBAL, INFO — ikke fejl, #2251). Samme kø-betingelse som
  // (b), men nedgraderet: "ingen resultater importeret NOGET sted i >stageHours" er
  // ofte normal post-chronrebuild-kø-latency (enkelt-etaper sidder empirisk 2-103t
  // "due" mens scheduleren arbejder sig gennem en kø, prod 2026-07-03) — IKKE et
  // ægte hang i sig selv. De præcise (b)-findings ovenfor er den reelle alarm; dette
  // er kun et throughput-signal til logs (processStallWatchdog alarmerer aldrig på
  // level:'info').
  if (queuedWork.length) {
    const resultsAge = ageHours(now, standings?.maxResultsImported ?? null);
    if (resultsAge > t.stageHours) {
      const examples = [...new Set(queuedWork.map((s) => s.race_name).filter(Boolean))].slice(0, 3);
      findings.push({
        type: "stage_throughput",
        level: "info",
        queuedCount: queuedWork.length,
        ageHours: round1(resultsAge),
        detail:
          `${queuedWork.length} forfalden(e) etape(r) m. startfelt venter, men ingen resultater ` +
          `importeret NOGET sted i ${Number.isFinite(resultsAge) ? Math.round(resultsAge) + "t" : "sæsonen"} ` +
          `(info — se præcise etape-stall-findings for hvilke løb)` +
          (examples.length ? ` (fx ${examples.join(", ")})` : ""),
      });
    }
  }

  // (c) prize-payout-stall — kun når auto-prize er tændt
  if (autoPrizeEnabled) {
    for (const r of prizeCandidates) {
      const age = ageHours(now, lastResultByRace[r.id] ?? null);
      if (age > t.prizeHours) {
        findings.push({
          type: "prize",
          raceId: r.id,
          raceName: r.name,
          ageHours: round1(age),
          detail: Number.isFinite(age)
            ? `Completed men prize_paid_at NULL ${Math.round(age)}t efter sidste resultat`
            : "Completed men prize_paid_at NULL; ingen race_results fundet",
        });
      }
    }
  }

  // (d) standings-lag
  const { maxStandingsUpdated = null, maxResultsImported = null } = standings || {};
  if (maxResultsImported) {
    const lag = maxStandingsUpdated
      ? (new Date(maxResultsImported).getTime() - new Date(maxStandingsUpdated).getTime()) / HOUR_MS
      : ageHours(now, maxResultsImported);
    if (lag > t.standingsHours) {
      findings.push({
        type: "standings",
        ageHours: round1(lag),
        detail: maxStandingsUpdated
          ? `season_standings ${Math.round(lag)}t bag seneste race_results`
          : "season_standings aldrig opdateret trods importerede race_results",
      });
    }
  }

  // (e) matview-refresh-stall (GLOBAL, #2196 Del 2). Fyrer KUN når vi HAR et
  // heartbeat-timestamp OG friske results: mangler heartbeatet (tabellen ikke
  // applied endnu, eller rækken tom) springes checken over, så et backend-deploy
  // FØR migrationen ikke false-alarmerer. Kan derfor kun give en ægte positiv —
  // et reelt heartbeat der er faldet bag race_results (refresh-sti død).
  if (maxResultsImported && matviewHeartbeat) {
    const lag =
      (new Date(maxResultsImported).getTime() - new Date(matviewHeartbeat).getTime()) / HOUR_MS;
    if (lag > t.matviewStaleHours) {
      findings.push({
        type: "matview",
        ageHours: round1(lag),
        detail:
          `Rangliste-matviews ${Math.round(lag * 60)}min bag seneste race_results — ` +
          `refresh_ranking_matviews()-stien (finalization-hook + cron) stallet; ` +
          `/standings + /rider-rankings viser stale tal`,
      });
    }
  }

  return findings;
}

/**
 * I/O-lag: henter alle rows evaluatoren behøver fra Supabase. Kaster ved query-fejl
 * (ikke tavst `|| []`) så trackedTick surfacer det i Sentry. Scoper til aktiv sæson.
 */
// Range-pagineret + id-chunked load af race-scopede tabeller. race_results-rækker =
// løb × etaper × ryttere, så et enkelt flerugers etapeløb alene sprænger PostgREST's
// 1000-rækkers cap; en rå .in() trunkerer TAVST (samme klasse som #1798/#1839).
//
// Netop dét gav watchdogen FALSKE etape-stall-alarmer (#2430): resultKeys blev bygget
// af de første 1000 af 7.277 rækker, så etaper der HAVDE resultater så tomme ud →
// "forfalden m. startfelt, ingen resultater". Sorteringen SKAL være total (unik nøgle
// sidst: id — eller PK-kolonnerne via orderCols for tabeller uden id-kolonne, #2536),
// ellers kan ties flytte rækker mellem sider → gaps.
async function fetchAllRaceRows(supabase, table, columns, raceIds, orderCols = ["id"]) {
  const ID_CHUNK = 300;
  const rows = [];
  for (let i = 0; i < raceIds.length; i += ID_CHUNK) {
    const chunk = raceIds.slice(i, i + ID_CHUNK);
    const page = await fetchAllRows(() =>
      orderCols.reduce(
        (q, col) => q.order(col),
        supabase.from(table).select(columns).in("race_id", chunk)
      )
    );
    rows.push(...page);
  }
  return rows;
}

export async function fetchWatchdogState({ supabase, now = new Date(), thresholds, autoPrizeEnabled = false }) {
  const t = { ...STALL_WATCHDOG_DEFAULT_THRESHOLDS, ...thresholds };

  const run = async (builder, label) => {
    const { data, error } = await builder;
    if (error) throw new Error(`stall-watchdog ${label}: ${error.message}`);
    return data || [];
  };

  // Aktiv sæson
  const { data: season, error: seasonErr } = await supabase
    .from("seasons")
    .select("id")
    .eq("status", "active")
    .order("number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (seasonErr) throw new Error(`stall-watchdog seasons: ${seasonErr.message}`);
  if (!season) return { seasonId: null };
  const sid = season.id;

  // (a) finalization-kandidater — column-to-column (stages_completed>=stages) filtreres i JS
  const nonCompleted = await run(
    supabase
      .from("races")
      .select("id,name,stages,stages_completed")
      .eq("season_id", sid)
      .neq("status", "completed")
      .gt("stages", 0),
    "races(non-completed)"
  );
  const finalizeCandidates = nonCompleted
    .filter((r) => (r.stages_completed ?? 0) >= r.stages)
    .map((r) => ({ id: r.id, name: r.name }));

  // (c) prize-kandidater — kun hvis auto-prize er tændt
  let prizeCandidates = [];
  if (autoPrizeEnabled) {
    const rows = await run(
      supabase
        .from("races")
        .select("id,name")
        .eq("season_id", sid)
        .eq("status", "completed")
        .is("prize_paid_at", null),
      "races(prize-null)"
    );
    prizeCandidates = rows.map((r) => ({ id: r.id, name: r.name }));
  }

  // lastResultByRace for (a)+(c)-kandidater
  const anchorIds = [...new Set([...finalizeCandidates, ...prizeCandidates].map((r) => r.id))];
  const lastResultByRace = {};
  if (anchorIds.length) {
    const rows = await fetchAllRaceRows(supabase, "race_results", "race_id,imported_at,id", anchorIds);
    for (const row of rows) {
      const cur = lastResultByRace[row.race_id];
      if (!cur || new Date(row.imported_at) > new Date(cur)) lastResultByRace[row.race_id] = row.imported_at;
    }
    for (const id of anchorIds) if (!(id in lastResultByRace)) lastResultByRace[id] = null;
  }

  // (b) forfaldne etaper (aktiv sæson, ikke-completede løb) via embedded inner-join
  const stageCutoff = new Date(now.getTime() - t.stageHours * HOUR_MS).toISOString();
  const dueRaw = await run(
    supabase
      .from("race_stage_schedule")
      .select("race_id,stage_number,scheduled_at,races!inner(name,status,season_id)")
      .lt("scheduled_at", stageCutoff)
      .eq("races.season_id", sid)
      .neq("races.status", "completed")
      .order("scheduled_at", { ascending: true }),
    "race_stage_schedule(due)"
  );
  const dueRaceIds = [...new Set(dueRaw.map((s) => s.race_id))];
  const resultKeys = new Set();
  const entryRaceIds = new Set();
  if (dueRaceIds.length) {
    const rr = await fetchAllRaceRows(supabase, "race_results", "race_id,stage_number,id", dueRaceIds);
    for (const row of rr) resultKeys.add(`${row.race_id}:${row.stage_number}`);
    // race_entries har composite PK (race_id, rider_id) og INGEN id-kolonne (#2536,
    // samme fantom-kolonne-klasse som #2516) — total orden via PK-kolonnerne.
    const ent = await fetchAllRaceRows(supabase, "race_entries", "race_id,rider_id", dueRaceIds, ["race_id", "rider_id"]);
    for (const row of ent) entryRaceIds.add(row.race_id);
  }
  const dueStages = dueRaw.map((s) => ({
    race_id: s.race_id,
    race_name: s.races?.name ?? null,
    stage_number: s.stage_number,
    scheduled_at: s.scheduled_at,
    has_results: resultKeys.has(`${s.race_id}:${s.stage_number}`),
    has_entries: entryRaceIds.has(s.race_id),
  }));

  // (d) standings-lag: max(standings.updated_at) vs max(results.imported_at) i aktiv sæson
  const { data: standRow, error: standErr } = await supabase
    .from("season_standings")
    .select("updated_at")
    .eq("season_id", sid)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (standErr) throw new Error(`stall-watchdog season_standings: ${standErr.message}`);
  const { data: resRow, error: resErr } = await supabase
    .from("race_results")
    .select("imported_at,races!inner(season_id)")
    .eq("races.season_id", sid)
    .order("imported_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (resErr) throw new Error(`stall-watchdog race_results(max): ${resErr.message}`);

  // (e) matview-refresh-heartbeat. Findes tabellen ikke endnu (backend deployet FØR
  // migrationen), degradér til null → check (e) springes over i stedet for at kaste
  // og spamme Sentry hvert 30. min indtil ejeren merger. Andre fejl kastes (ægte problem).
  let matviewHeartbeat = null;
  const { data: hbRow, error: hbErr } = await supabase
    .from("matview_refresh_heartbeat")
    .select("refreshed_at")
    .eq("matview_group", "ranking")
    .maybeSingle();
  if (hbErr) {
    const missingTable =
      hbErr.code === "42P01" || // Postgres undefined_table
      hbErr.code === "PGRST205" || // PostgREST: table ikke i schema-cache
      /does not exist|could not find the table/i.test(hbErr.message || "");
    if (!missingTable) {
      throw new Error(`stall-watchdog matview_refresh_heartbeat: ${hbErr.message}`);
    }
  } else {
    matviewHeartbeat = hbRow?.refreshed_at ?? null;
  }

  return {
    seasonId: sid,
    finalizeCandidates,
    prizeCandidates,
    lastResultByRace,
    dueStages,
    standings: {
      maxStandingsUpdated: standRow?.updated_at ?? null,
      maxResultsImported: resRow?.imported_at ?? null,
    },
    matviewHeartbeat,
  };
}

/**
 * Orchestrator: fetch → evaluate → dedup → alarm (Discord ops-kanal + Sentry).
 * `seenKeys` er et delt Set (module-level i cron.js) der giver dedup pr. dag.
 */
export async function processStallWatchdog({
  supabase,
  now = new Date(),
  sendWebhookFn,
  getOpsWebhookFn,
  captureExceptionFn,
  autoPrizeEnabled = false,
  seenKeys = new Set(),
  thresholds = STALL_WATCHDOG_DEFAULT_THRESHOLDS,
  fetchStateFn = fetchWatchdogState,
} = {}) {
  if (!supabase?.from) throw new Error("Supabase client required");

  const state = await fetchStateFn({ supabase, now, thresholds, autoPrizeEnabled });
  if (!state.seasonId) {
    return { findings: [], newFindings: [], alerted: false, skipped: "no_active_season" };
  }

  const findings = evaluateStallFindings({ now, thresholds, autoPrizeEnabled, ...state });

  // Dedup: kun findings vi ikke allerede har set/alarmeret om i dag. Gælder BÅDE
  // info- og alert-niveau-findings — samme (check,løb,dag)-nøgle-rum.
  const deduped = [];
  for (const f of findings) {
    const key = findingKey(f, now);
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    deduped.push(f);
  }
  // Hold seenKeys bounded (mirror stageScheduler-dedup) — dag-nøgler ruller alligevel
  if (seenKeys.size > 1000) seenKeys.clear();

  // #2251: INFO-niveau (fx det globale etape-gennemløbs-signal) logges kun — alarmerer
  // ALDRIG Discord/Sentry. Dette signal støjede tidligere som en fejl-alarm hver nat
  // mellem løbsdage uden ét ægte hang (7 events/døgn, 0 reelle stalls).
  const infoFindings = deduped.filter((f) => f.level === "info");
  for (const f of infoFindings) {
    console.log(`  ℹ️ stall-watchdog (info): ${labelForType(f.type)} — ${f.detail}`);
  }

  const newFindings = deduped.filter((f) => f.level !== "info");
  if (!newFindings.length) {
    return { findings, newFindings: [], infoFindings, alerted: false };
  }

  // Discord: ét aggregeret embed til ops-kanalen (@mention tilføjes af sendWebhookFn)
  const url = getOpsWebhookFn ? await getOpsWebhookFn() : null;
  if (url && sendWebhookFn) {
    await sendWebhookFn(url, {
      embeds: [
        {
          title: `🚨 Stall-watchdog: ${newFindings.length} tavs(e) stall(s) opdaget`,
          description:
            "Løb/finalisering/præmier/standings sidder fast UDEN exception. Undersøg straks.",
          color: 0xe74c3c,
          fields: newFindings.slice(0, 24).map((f) => ({
            name: labelForType(f.type) + (f.raceName ? ` — ${f.raceName}` : ""),
            value: f.detail,
          })),
          timestamp: now.toISOString(),
        },
      ],
    });
  }

  // Sentry: én capture pr. distinkt check-type (pæn gruppering pr. failure-mode)
  if (captureExceptionFn) {
    const byType = new Map();
    for (const f of newFindings) {
      if (!byType.has(f.type)) byType.set(f.type, []);
      byType.get(f.type).push(f);
    }
    for (const [type, items] of byType) {
      captureExceptionFn(new Error(`Stall-watchdog: ${type} stall (${items.length})`), {
        tags: { cron: "stall-watchdog", check: type },
        extra: { items },
      });
    }
  }

  return { findings, newFindings, infoFindings, alerted: true };
}
