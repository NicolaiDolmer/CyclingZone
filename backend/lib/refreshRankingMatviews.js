// #2175/#3013: refresh af rangliste-matviews (rider_rankings_mv,
// team_standings_ext_mv, team_race_points_mv, global_rank_mv) + #5647
// youth_rider_rankings_mv. "Fire" nedenfor er den historiske senior-kerne; listen
// REFRESH_RPCS er sandheden for hvor mange der kaldes.
//
// Matviews aggregerer fra race_results, så de skal refreshes når nye resultater
// skrives (race-finalization) — ellers driver /standings + /rider-rankings.
// En cron-fallback (cron.js) kalder den samme funktion periodisk og fanger enhver
// misset refresh (fx hvis en finalization-sti fejlede halvvejs).
//
// #3013: fire SEPARATE RPC-kald i stedet for ét. REFRESH MATERIALIZED VIEW uden
// CONCURRENTLY tager ACCESS EXCLUSIVE-lås; den gamle refresh_ranking_matviews()
// kørte alle fire i ÉN transaktion, så en læser af den HURTIGSTE matview kunne
// stå og vente på den LANGSOMSTE (målt maks 7,8s i prod, dengang mod et
// statement_timeout på 8s). Fire separate transaktioner (database/2026-07-27-
// 3013-refresh-matviews-concurrently.sql) frigiver hver lås så snart DEN matview
// er færdig i stedet for at holde alle fire til den sidste er done.
// #5692: den gamle SPI/isTopLevel-påstand var forkert for PostgreSQL 17.
// Hvert kald vælger token/version-fenced overloaden med p_concurrently=true
// fra database/2026-10-06-5692-ranking-refresh-events.sql. Den kører CONCURRENTLY
// i samme SECURITY DEFINER/PostgREST-transport. Ingen fallback til plain REFRESH:
// mangler overload/index/populerede data, beholdes sidste færdige snapshot og
// heartbeat flyttes ikke. SQL-migration kræver separat ejer-go før aktivering.
//
// TIMEOUT-BUDGET (#4866, gældende fra 5/9): de fire RPC'er går gennem PostgREST
// som service_role. Rollen havde ingen egen rolconfig og arvede derfor
// authenticator-sessionens statement_timeout=8s — samme loft som spillernes
// kald — og refresh_team_race_points_mv ramte det (500 til kalderen 5/9 kl.
// 11:17). database/2026-09-05-4866-service-role-statement-timeout.sql sætter
// ALTER ROLE service_role SET statement_timeout = '60s'; PostgREST anvender den
// impersonerede rolles indstillinger transaktions-scoped, så dette loft gælder
// netop de kald der laves herfra. Loftet er altså IKKE 8s længere for denne
// kodesti. lock_timeout er BEVIDST ikke hævet (arver 8s): et refresh der venter
// på ACCESS EXCLUSIVE-låsen trækker hele læser-køen med ned, så fail-fast +
// cron-retry er den ønskede adfærd. Ændrer du transport (rå pg-forbindelse,
// pg_cron) eller flytter kaldene væk fra service_role, forsvinder de 60s —
// forward-guarden i refreshRankingMatviews.test.js fanger det.
//
// #5692 events: DB statement triggers register relevant committed changes,
// including historical corrections and rider ownership. Clean cron ticks only
// check state. Cross-process claims capture a version; token-fenced concurrent
// RPCs validate ownership at SQL admission, and completion/heartbeat commit
// atomically after all five succeed. No fallback to plain refresh.
//
// Result publication schedules a coalesced background wakeup and never awaits
// global computation. The one-minute cron catches missed wakeups/restarts.
// Training deferral is bounded by durable oldest work age. Explicit Safe is a
// forced repair, bypassing training; a busy foreign owner is not completion.
// Production lease time comes from SQL after locking, not the caller's clock.
// An unavailable state keeps the last snapshot and reports failure for retry.
import { copenhagenDateString, copenhagenHour } from "./copenhagenTime.js";
import { createRankingRefreshQueue } from "./rankingRefreshQueue.ts";
import { getRankingRefreshWorkState, runRankingRefreshWork } from "./rankingRefreshWork.ts";

export const SETTLEMENT_WINDOW_START_HOUR = 20;
export const SETTLEMENT_OVERNIGHT_END_HOUR = 3;
export const MAX_DEFER_MS = 2 * 60 * 1000;
export const COALESCE_WINDOW_MS = 60 * 1000;

const REFRESH_RPCS = [
  { rpc: "refresh_rider_rankings_mv", label: "rider_rankings_mv" },
  { rpc: "refresh_team_standings_ext_mv", label: "team_standings_ext_mv" },
  { rpc: "refresh_team_race_points_mv", label: "team_race_points_mv" },
  { rpc: "refresh_global_rank_mv", label: "global_rank_mv" },
  // #5647 (Y7 / plan S5): ungdoms-rytterranglisten (kun løb med squad <> 'senior',
  // database/2026-09-25-4620-youth-rider-rankings-mv.sql). SIDST i rækken, så de
  // fire seniorviews altid refreshes først. Indgår i heartbeat-invarianten som de
  // andre: "ranking"-heartbeatet betyder at ALLE rangliste-matviews er friske.
  { rpc: "refresh_youth_rider_rankings_mv", label: "youth_rider_rankings_mv" },
];

const runRefreshQueued = createRankingRefreshQueue();

// #5900: all entry points (cron/finalization/training/recovery) share admission.
// Requests during a pass share one fresh follow-up, preserving later DB writes.
export function refreshRankingMatviewsSafe(supabase, options = {}) {
  return runRefreshQueued(supabase, async () => (await runRankingRefreshWork(supabase,
    (renewLease, ownerToken, targetVersion) => refreshRankingMatviewsPass(supabase, { ...options, renewLease, ownerToken, targetVersion }), { ...options, force: true })) === true, 1);
}

async function refreshRankingMatviewsPass(supabase, { captureExceptionFn, renewLease, ownerToken, targetVersion } = {}) {
  const failures = [];

  for (const { rpc, label } of REFRESH_RPCS) {
    try {
      if (renewLease && !await renewLease()) throw new Error('Ranking refresh claim lost');
      const { error } = await supabase.rpc(rpc, { p_concurrently: true, p_owner_token: ownerToken, p_target_version: targetVersion });
      if (error) throw new Error(error.message);
    } catch (err) {
      failures.push({ label, message: err.message });
      console.warn(`⚠️  ${rpc} fejlede (best-effort, cron fanger den): ${err.message}`);
    }
  }

  if (failures.length > 0) {
    if (captureExceptionFn) {
      captureExceptionFn(
        new Error(`refreshRankingMatviewsSafe: ${failures.length}/${REFRESH_RPCS.length} matview-refresh fejlede`),
        {
          tags: { lib: "refreshRankingMatviews" },
          extra: { failures },
        }
      );
    }
    return false;
  }

  // The fenced database acknowledgement atomically updates generation + heartbeat.
  return true;
}

// ─── #5911: aftenafregningen først ───────────────────────────────────────────

// Sand når dagens (Copenhagen) træningsafregning stadig har hold i gang. Kaster
// ved opslagsfejl, så kalderen selv kan vælge fail-safe (refresh som før).
export async function isTrainingSettlementInProgress(supabase, { now = new Date(), dates = [copenhagenDateString(now)] } = {}) {
  const { data, error } = await supabase
    .from("training_date_work")
    .select("status")
    .in("tick_date", dates)
    .in("status", ["pending", "partial"])
    .limit(1);
  if (error) throw new Error(error.message);
  return (data?.length ?? 0) > 0;
}

// Hvilke træningsdatoer der kan være under afregning nu: dagens fra kl. 20, og
// gårsdagens efter midnat indtil afregningsfristen (kl. 02, + en times margen).
export function settlementDatesToCheck(now = new Date()) {
  const hour = copenhagenHour(now);
  if (hour >= SETTLEMENT_WINDOW_START_HOUR) return [copenhagenDateString(now)];
  if (hour < SETTLEMENT_OVERNIGHT_END_HOUR) return [copenhagenDateString(new Date(now.getTime() - 12 * 3600 * 1000))];
  return [];
}

export function __resetRankingRefreshStateForTests() {
  coalesceState = new WeakMap();
}

// Gate for cron + finalisering. Returnerer "deferred" når refreshen holdes
// tilbage, ellers refreshRankingMatviewsSafe's true/false.
async function rankingRefreshGateState(
  supabase,
  { now = new Date(), maxDeferMs = MAX_DEFER_MS, logger = console } = {},
) {
  let work;
  try { work = await getRankingRefreshWorkState(supabase, now); }
  catch {
    // best-effort: retain old data and report unavailable; never refresh blindly.
    logger.warn?.('[ranking-refresh] work state unavailable; snapshot preserved'); return 'unavailable';
  }
  if (!work.pending) return 'clean';
  let settling = false;
  const dates = settlementDatesToCheck(now);
  if (dates.length) {
    try {
      settling = await isTrainingSettlementInProgress(supabase, { now, dates });
    } catch (err) {
      // best-effort: fail-safe, uden statusopslag refreshes som før #5911.
      logger.warn?.(`⚠️  ranking refresh: training status lookup failed, refreshing anyway: ${err.message}`);
    }
  }
  if (settling) {
    if (work.pendingAgeMs < maxDeferMs) {
      logger.log?.("[ranking-refresh] deferred: training settlement in progress");
      return "deferred";
    }
    logger.warn?.("[ranking-refresh] max deferral reached during training settlement, refreshing anyway");
    // Keep the interval alive while admission is pending. The caller carries
    // this entitlement through the queue, even if later requests are gated.
    return "expired";
  }
  return "ready";
}

export async function refreshRankingMatviewsGated(
  supabase,
  { captureExceptionFn, now = new Date(), clock = () => Date.now(), maxDeferMs = MAX_DEFER_MS, logger = console, heartbeatNowFn = () => new Date(), testNowFn } = {},
) {
  const requestedAt = clock();
  void heartbeatNowFn; // Completion time is authoritative in SQL; retain option compatibility.
  const gateOptions = { now, clock, maxDeferMs, logger };
  const gateState = await rankingRefreshGateState(supabase, gateOptions);
  if (gateState === 'unavailable') return false;
  if (gateState === 'clean') return true;
  if (gateState === "deferred") return "deferred";
  return runRefreshQueued(supabase,
    () => runRankingRefreshWork(supabase,
      (renewLease, ownerToken, targetVersion) => refreshRankingMatviewsPass(supabase, { captureExceptionFn, renewLease, ownerToken, targetVersion }), { captureExceptionFn, testNowFn }),
    gateState === "expired" ? 1 : 0, {
      key: `gated:${copenhagenDateString(now)}:${maxDeferMs}`,
      check: async () => {
      const admittedAt = new Date(now.getTime() + Math.max(0, clock() - requestedAt));
      const state = await rankingRefreshGateState(supabase, { ...gateOptions, now: admittedAt });
      if (state === 'unavailable') return { kind: 'skip', result: false };
      if (state === 'clean') return { kind: 'skip', result: true };
      if (state === "deferred") return { kind: "skip", result: "deferred" };
      return { kind: state === "expired" ? "force" : "proceed" };
      },
    });
}

// Træningslukningen kalder denne efter et sweep der afregnede dagens hold. Er
// sidste hold færdigt (ingen pending/partial for i dag), refreshes straks og
// ubetinget; ellers venter den på næste sweep/cron. Kaster aldrig.
export async function refreshRankingsAfterTrainingSettlement({ supabase, now = new Date(), captureExceptionFn, logger = console, heartbeatNowFn = () => new Date(), clock = () => Date.now(), testNowFn } = {}) {
  void heartbeatNowFn;
  const requestedAt = clock();
  try {
    let settling = false;
    try {
      settling = await isTrainingSettlementInProgress(supabase, { now });
    } catch (err) {
      // best-effort: fail-safe, uden statusopslag refreshes straks.
      logger.warn?.(`⚠️  ranking refresh after training: status lookup failed, refreshing anyway: ${err.message}`);
    }
    if (settling) return "deferred";
    return await runRefreshQueued(supabase,
      () => runRankingRefreshWork(supabase,
        (renewLease, ownerToken, targetVersion) => refreshRankingMatviewsPass(supabase, { captureExceptionFn, renewLease, ownerToken, targetVersion }), { captureExceptionFn, testNowFn }),
      0, {
        key: `training-close:${copenhagenDateString(now)}`,
        check: async () => {
        const admittedAt = new Date(now.getTime() + Math.max(0, clock() - requestedAt));
        try {
          const dates = [...new Set([copenhagenDateString(now), copenhagenDateString(admittedAt)])];
          if (await isTrainingSettlementInProgress(supabase, { now: admittedAt, dates })) return { kind: "skip", result: "deferred" };
        } catch (err) {
          // best-effort: preserve the existing status-lookup fail-open policy;
          // the actual refresh still validates every RPC and its heartbeat.
          logger.warn?.(`⚠️  ranking refresh after training: queued status lookup failed, refreshing anyway: ${err.message}`);
        }
        return { kind: "proceed" };
        },
      });
  } catch (err) {
    // best-effort: en refresh-fejl må aldrig vælte træningsafregningen.
    logger.warn?.(`⚠️  ranking refresh after training failed (cron catches it): ${err.message}`);
    return false;
  }
}

// Publication never awaits global ranking computation. Durable DB events are
// authoritative; this per-client wakeup timer only reduces scheduling latency.
let coalesceState = new WeakMap();

export async function requestRankingMatviewRefresh(
  supabase,
  {
    captureExceptionFn,
    windowMs = COALESCE_WINDOW_MS,
    clock = () => Date.now(),
    nowFn = () => new Date(),
    testNowFn,
    setTimer = setTimeout,
    refresh = (client, opts) => refreshRankingMatviewsGated(client, { ...opts, clock, heartbeatNowFn: nowFn, testNowFn }),
    logger = console,
  } = {},
) {
  let state = coalesceState.get(supabase);
  if (!state) {
    state = { timer: null };
    coalesceState.set(supabase, state);
  }
  if (state.timer) return "coalesced";
  state.timer = setTimer(() => {
    state.timer = null;
    Promise.resolve()
      .then(() => refresh(supabase, { captureExceptionFn, now: nowFn(), logger }))
      .catch((err) => logger.warn?.(`⚠️  coalesced ranking refresh failed (cron catches it): ${err.message}`));
  }, windowMs);
  state.timer?.unref?.();
  return "coalesced";
}
