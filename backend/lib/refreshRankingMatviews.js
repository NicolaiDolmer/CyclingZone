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
// er færdig i stedet for at holde alle fire til den sidste er done. CONCURRENTLY
// er IKKE muligt her — Postgres afviser den fra enhver funktion kaldt via
// RPC/SPI, se migrationens header-kommentar. Ægte nul-blokering kræver en
// transport-ændring (pg_cron eller rå pg-forbindelse), sporet som opfølgning på
// #3013 i #3121.
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
// Heartbeat-atomicitet (#2196 Del 2): den ORIGINALE refresh_ranking_matviews()
// skrev matview_refresh_heartbeat KUN hvis alle fire REFRESH lykkedes i samme
// transaktion ("heartbeat kan ikke lyve"). Med fire separate RPC'er kan det ikke
// garanteres i databasen længere, så Node overtager invarianten: heartbeat
// upsertes KUN herfra, og KUN hvis alle fire RPC-kald returnerede uden fejl.
//
// BEST-EFFORT: en refresh-fejl logges + rapporteres til Sentry, men kastes ALDRIG
// videre. Kaldere er race-finalization (resultaterne ER allerede skrevet — en
// refresh-fejl må ikke vælte afviklingen) + cron (næste tick prøver igen).
// Fejler en RPC fordi migrationen endnu ikke er applied i prod (funktionen findes
// ikke endnu), er warn'en forventet og ufarlig — de andre matviews refreshes
// stadig (best-effort pr. matview, ikke alt-eller-intet).
//
// #5911: AFTENAFREGNINGEN HAR FORRANG. Refreshen tager ACCESS EXCLUSIVE pr.
// matview, og dagens sidste løb finaliserer lige før kl. 20, så refreshes landede
// oven i træningsafregningens commit_training_date_tick og trak den ud (målt 1/10).
// Derfor tre indgange:
//   - refreshRankingMatviewsSafe: ubetinget og straks (recovery, repair-scripts).
//   - refreshRankingMatviewsGated (10-min cron): springer over ("deferred") mens
//     training_date_work for i dag (Copenhagen, fra kl. 20) har pending/partial-
//     rækker. Loft: efter MAX_DEFER_MS i træk refreshes alligevel, så en afregning
//     der hænger (fx venter til deadline kl. 02) ikke fryser ranglisten.
//   - requestRankingMatviewRefresh (løbsfinalisering): gated + samlet, så flere løb
//     der slutter inden for samme vindue giver én refresh i stedet for én pr. løb.
//   - refreshRankingsAfterTrainingSettlement: træningslukningen kalder den efter et
//     sweep der afregnede dagens hold; den refresher når sidste hold er færdigt.
// FAIL-SAFE: fejler statusopslaget, refreshes som før #5911.
import { copenhagenDateString, copenhagenHour } from "./copenhagenTime.js";

export const SETTLEMENT_WINDOW_START_HOUR = 20;
export const MAX_DEFER_MS = 20 * 60 * 1000;
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

export async function refreshRankingMatviewsSafe(supabase, { captureExceptionFn } = {}) {
  const failures = [];

  for (const { rpc, label } of REFRESH_RPCS) {
    try {
      const { error } = await supabase.rpc(rpc);
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

  // Alle RPC'er lykkedes → heartbeat opdateres (bevarer "heartbeat kan ikke lyve"-
  // invarianten fra #2196 Del 2, nu på Node-siden i stedet for i én DB-transaktion).
  try {
    const { error: hbError } = await supabase
      .from("matview_refresh_heartbeat")
      .upsert({ matview_group: "ranking", refreshed_at: new Date().toISOString() }, { onConflict: "matview_group" });
    if (hbError) throw new Error(hbError.message);
  } catch (err) {
    console.warn(`⚠️  matview_refresh_heartbeat upsert fejlede (best-effort): ${err.message}`);
    if (captureExceptionFn) {
      captureExceptionFn(new Error(`refreshRankingMatviewsSafe heartbeat upsert: ${err.message}`), {
        tags: { lib: "refreshRankingMatviews" },
      });
    }
    // Matviews ER friske selvom heartbeat-skrivningen fejlede — returnér true,
    // stall-watchdog degraderer gracefully hvis heartbeat-rækken mangler/er stale
    // (samme disciplin som resten af filen: en observability-fejl må ikke
    // fremstå som en data-fejl).
  }

  return true;
}

// ─── #5911: aftenafregningen først ───────────────────────────────────────────

// Sand når dagens (Copenhagen) træningsafregning stadig har hold i gang. Kaster
// ved opslagsfejl, så kalderen selv kan vælge fail-safe (refresh som før).
export async function isTrainingSettlementInProgress(supabase, { now = new Date() } = {}) {
  const { data, error } = await supabase
    .from("training_date_work")
    .select("status")
    .eq("tick_date", copenhagenDateString(now))
    .in("status", ["pending", "partial"])
    .limit(1);
  if (error) throw new Error(error.message);
  return (data?.length ?? 0) > 0;
}

let deferredSinceMs = null;

export function __resetRankingRefreshStateForTests() {
  deferredSinceMs = null;
}

// Gate for cron + finalisering. Returnerer "deferred" når refreshen holdes
// tilbage, ellers refreshRankingMatviewsSafe's true/false.
export async function refreshRankingMatviewsGated(
  supabase,
  { captureExceptionFn, now = new Date(), clock = () => Date.now(), maxDeferMs = MAX_DEFER_MS, logger = console } = {},
) {
  let settling = false;
  if (copenhagenHour(now) >= SETTLEMENT_WINDOW_START_HOUR) {
    try {
      settling = await isTrainingSettlementInProgress(supabase, { now });
    } catch (err) {
      // Fail-safe: uden statusopslag refreshes som før #5911.
      logger.warn?.(`⚠️  ranking refresh: training status lookup failed, refreshing anyway: ${err.message}`);
    }
  }
  if (settling) {
    const nowMs = clock();
    deferredSinceMs ??= nowMs;
    if (nowMs - deferredSinceMs < maxDeferMs) {
      logger.log?.("[ranking-refresh] deferred: training settlement in progress");
      return "deferred";
    }
    logger.warn?.("[ranking-refresh] max deferral reached during training settlement, refreshing anyway");
  }
  deferredSinceMs = null;
  return refreshRankingMatviewsSafe(supabase, { captureExceptionFn });
}

// Træningslukningen kalder denne efter et sweep der afregnede dagens hold. Er
// sidste hold færdigt (ingen pending/partial for i dag), refreshes straks og
// ubetinget; ellers venter den på næste sweep/cron. Kaster aldrig.
export async function refreshRankingsAfterTrainingSettlement({ supabase, now = new Date(), captureExceptionFn, logger = console } = {}) {
  try {
    let settling = false;
    try {
      settling = await isTrainingSettlementInProgress(supabase, { now });
    } catch (err) {
      logger.warn?.(`⚠️  ranking refresh after training: status lookup failed, refreshing anyway: ${err.message}`);
    }
    if (settling) return "deferred";
    deferredSinceMs = null;
    return await refreshRankingMatviewsSafe(supabase, { captureExceptionFn });
  } catch (err) {
    // best-effort: en refresh-fejl må aldrig vælte træningsafregningen.
    logger.warn?.(`⚠️  ranking refresh after training failed (cron catches it): ${err.message}`);
    return false;
  }
}

// Samler refreshes ved løbsfinalisering: første kald i et roligt vindue kører
// straks (ranglisten er frisk lige efter løbet, #3193); kald inden for
// COALESCE_WINDOW_MS efter den seneste start samles til ÉN efterfølgende refresh
// ved vinduets udløb. Tilstand pr. Supabase-klient. Kaster aldrig.
const coalesceState = new WeakMap();

export async function requestRankingMatviewRefresh(
  supabase,
  {
    captureExceptionFn,
    windowMs = COALESCE_WINDOW_MS,
    clock = () => Date.now(),
    nowFn = () => new Date(),
    setTimer = setTimeout,
    refresh = (client, opts) => refreshRankingMatviewsGated(client, opts),
    logger = console,
  } = {},
) {
  let state = coalesceState.get(supabase);
  if (!state) {
    state = { lastStartedAt: -Infinity, timer: null };
    coalesceState.set(supabase, state);
  }
  if (state.timer) return "coalesced";
  const wait = state.lastStartedAt + windowMs - clock();
  if (wait > 0) {
    state.timer = setTimer(() => {
      state.timer = null;
      state.lastStartedAt = clock();
      Promise.resolve()
        .then(() => refresh(supabase, { captureExceptionFn, now: nowFn(), logger }))
        .catch((err) => logger.warn?.(`⚠️  coalesced ranking refresh failed (cron catches it): ${err.message}`));
    }, wait);
    state.timer?.unref?.();
    return "coalesced";
  }
  state.lastStartedAt = clock();
  try {
    return await refresh(supabase, { captureExceptionFn, now: nowFn(), logger });
  } catch (err) {
    logger.warn?.(`⚠️  ranking refresh failed (cron catches it): ${err.message}`);
    return false;
  }
}
