/**
 * Stall-watchdog (#2077) — fanger TAVSE stalls i race-pipelinen.
 * =============================================================
 * 30/6-2/7-incidenten kørte tavst i ~44 timer: updateStandings fejlede uden at
 * KASTE (URL-længde-limit), så exception-capture i stage-scheduleren fangede intet.
 * Denne watchdog tjekker hver 30. min for tilstande der er "stuck" UDEN en throw:
 *
 *   (a) finalization-stall  : alle etaper kørt (stages_completed >= stages) men
 *       status != 'completed', og sidste resultat-import er > finalizeHours gammel.
 *   (b) scheduler-progress-stall: forfaldne etaper med et reelt startfelt (entries>0)
 *       venter i køen, MEN scheduleren har ikke importeret ét eneste resultat i
 *       > stageHours. GLOBALT throughput-signal — ikke per-etape: empirisk sidder
 *       enkelt-etaper normalt mange timer "due" mens scheduleren arbejder gennem en
 *       kø (post-chronrebuild-catch-up), så en per-etape-tærskel ville spamme. Tomme
 *       spøgelsesløb (bund-divisioner uden managere) tælles aldrig med.
 *   (c) prize-payout-stall  : completed løb med prize_paid_at NULL > prizeHours
 *       efter sidste resultat-import — KUN når auto_prize er tændt (ellers betales
 *       præmier manuelt og NULL er forventet → ingen alarm).
 *   (d) standings-lag       : season_standings.updated_at hænger > standingsHours
 *       bag race_results.imported_at (results importeret men standings ikke opdateret).
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

export const STALL_WATCHDOG_DEFAULT_THRESHOLDS = {
  finalizeHours: 2,
  stageHours: 2,
  prizeHours: 1,
  standingsHours: 1,
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
  prize: "💰 Præmie-stall",
  standings: "📊 Standings-lag",
};

export function labelForType(type) {
  return TYPE_LABELS[type] || type;
}

/**
 * Dedup-nøgle: én alarm pr. (check, løb, dag). Standings er sæson-globalt.
 */
export function findingKey(finding, now) {
  const day = dayKey(now);
  // stage + standings er GLOBALE (sæson-brede) signaler → dedup pr. dag.
  // finalize + prize er pr. løb → dedup pr. (løb, dag).
  if (finding.type === "standings" || finding.type === "stage") return `${finding.type}:${day}`;
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

  // (b) scheduler-progress-stall (GLOBAL, ikke pr. løb). Forfaldne etaper m. reelt
  // startfelt venter i køen, MEN scheduleren har ikke importeret ét eneste resultat
  // i > stageHours. Empirisk (prod 2026-07-03): enkelt-etaper sidder normalt 2-103t
  // "due" mens scheduleren arbejder sig gennem en post-chronrebuild-kø — en per-etape-
  // tærskel ville derfor spamme. Det ægte stall-signal er throughput: motoren "kører"
  // men producerer INTET trods kø (præcis P0-mønstret 30/6-2/7). Robust mod både
  // normal kø-latency (results flyder → ingen alarm) og backdatede schedule-rows.
  const queuedWork = dueStages.filter((s) => s.has_entries && !s.has_results);
  if (queuedWork.length) {
    const resultsAge = ageHours(now, standings?.maxResultsImported ?? null);
    if (resultsAge > t.stageHours) {
      const examples = [...new Set(queuedWork.map((s) => s.race_name).filter(Boolean))].slice(0, 3);
      findings.push({
        type: "stage",
        queuedCount: queuedWork.length,
        ageHours: round1(resultsAge),
        detail:
          `${queuedWork.length} forfalden(e) etape(r) m. startfelt venter, men ingen resultater ` +
          `importeret i ${Number.isFinite(resultsAge) ? Math.round(resultsAge) + "t" : "sæsonen"} — ` +
          `scheduleren producerer intet trods kø` +
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

  return findings;
}

/**
 * I/O-lag: henter alle rows evaluatoren behøver fra Supabase. Kaster ved query-fejl
 * (ikke tavst `|| []`) så trackedTick surfacer det i Sentry. Scoper til aktiv sæson.
 */
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
    const rows = await run(
      supabase.from("race_results").select("race_id,imported_at").in("race_id", anchorIds),
      "race_results(anchors)"
    );
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
    const rr = await run(
      supabase.from("race_results").select("race_id,stage_number").in("race_id", dueRaceIds),
      "race_results(due-stages)"
    );
    for (const row of rr) resultKeys.add(`${row.race_id}:${row.stage_number}`);
    const ent = await run(
      supabase.from("race_entries").select("race_id").in("race_id", dueRaceIds),
      "race_entries(due-stages)"
    );
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

  // Dedup: kun findings vi ikke allerede har alarmeret om i dag
  const newFindings = [];
  for (const f of findings) {
    const key = findingKey(f, now);
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    newFindings.push(f);
  }
  // Hold seenKeys bounded (mirror stageScheduler-dedup) — dag-nøgler ruller alligevel
  if (seenKeys.size > 1000) seenKeys.clear();

  if (!newFindings.length) {
    return { findings, newFindings: [], alerted: false };
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

  return { findings, newFindings, alerted: true };
}
