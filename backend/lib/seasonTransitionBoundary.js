// #4004 — sæsonskifte-guardens anker.
//
// MÅLT MOD PROD 21/8 (orkestrator): guardens oprindelige anker
// (transfer_windows.closes_at) var DØD DATA — begge rækker i prod har
// status='closed' og closes_at=NULL (markedet har været altid-åbent siden
// 22/6, jf. #3317-familien). getAuctionSeasonBoundaryIssue ville derfor
// ALDRIG fyre i prod, uanset hvor lang en auktion man oprettede.
//
// Nyt anker, i prioriteret rækkefølge:
//   1. app_config-nøglen SEASON_TRANSITION_PLANNED_AT_KEY (ISO-timestamp) —
//      et eksplicit planlagt tidspunkt for selve sæson-transitionen, hvis
//      ejeren har sat et. Dette findes IKKE i skemaet i dag (samme
//      begrænsning som den oprindelige PR-body dokumenterede for
//      transfer_windows) — nøglen er fremadrettet forberedt, ikke aktivt sat.
//   2. Ellers: den kommende sæson (seasons.status='upcoming') sin start_date
//      MINUS én dag kl. 18:00 dansk tid — transitionen kører aftenen FØR
//      sæsonstart (season_auto_transition er slukket; transitionen er en
//      manuel admin-handling, typisk kørt aftenen før, se
//      docs/NIGHT_WAVE_RUNBOOK.md).
//   3. Ingen upcoming sæson → ingen grænse (ingen blokering — samme fail-open
//      retning som den oprindelige transfer_windows-baserede guard havde ved
//      manglende/ugyldig data).
import { copenhagenHourToUTC } from "./copenhagenTime.js";
import { ADMIN_ACTION_TYPE } from "./economyConstants.js";
import { TRANSITION_PHASE_LOG_SOURCE, TRANSITION_PHASE_STATUS } from "./seasonTransitionPhaseLog.js";

export const SEASON_TRANSITION_PLANNED_AT_KEY = "season_transition_planned_at";

// Fallback-klokkeslættet (dansk tid) transitionen typisk køres på, aftenen
// før sæsonstart. Ren dokumentation/test-værdi — selve beregningen sker via
// copenhagenHourToUTC.
export const TRANSITION_FALLBACK_HOUR_COPENHAGEN = 18;

/**
 * Ren beregning — intet DB-kald, fuldt testbar uden supabase-mock.
 *
 * @param {{plannedAt?: string|null, upcomingSeasonStartDate?: string|null}} inputs
 * @returns {Date|null}
 */
export function computeSeasonTransitionBoundary({ plannedAt, upcomingSeasonStartDate } = {}) {
  if (plannedAt) {
    const explicit = new Date(plannedAt);
    if (!Number.isNaN(explicit.getTime())) return explicit;
  }
  if (upcomingSeasonStartDate) {
    // seasons.start_date er en ren DATE-kolonne (ingen tid/tidszone) — "minus én
    // dag" er derfor ren kalender-aritmetik, ikke tidszone-følsom. Date.UTC
    // håndterer korrekt måned-/år-rul (fx 2026-01-01 → 2025-12-31).
    const [y, m, d] = String(upcomingSeasonStartDate).slice(0, 10).split("-").map(Number);
    if (y && m && d) {
      const prevDayUTC = new Date(Date.UTC(y, m - 1, d - 1));
      const prevDayStr = prevDayUTC.toISOString().slice(0, 10);
      return copenhagenHourToUTC(prevDayStr, TRANSITION_FALLBACK_HOUR_COPENHAGEN);
    }
  }
  return null;
}

// #5846 — gaten gælder kun et KOMMENDE skifte (eller et der kører lige nu).
//
// Efter S3→S4 (27/9) stod app_config-nøglen stadig på skiftets tidspunkt
// (2026-09-27T17:30Z). Den blev aldrig ryddet, og getAuctionSeasonBoundaryIssue
// afviser enhver sluttid på/efter grænsen: en grænse i FORTIDEN spærrede derfor
// alle nye auktioner. Nøglen overskrives først, når næste sæsons kalender bygges.
//
// Reglen (ren, resolveActiveSeasonTransitionBoundary):
//   - Et skifte der er GENNEMFØRT (fase-loggens 'completed'-anker i admin_log,
//     seasonTransitionPhaseLog.js) højst SEASON_TRANSITION_EARLY_RUN_TOLERANCE_MS
//     før grænsen eller når som helst efter den, har "brugt" grænsen → ingen gate.
//   - Et skifte der KØRER (seneste fase-anker er 'started'/'failed' og nyere end
//     det seneste 'completed') → alle nye auktioner spærres. Det er beskyttelsen
//     af pensionister og kontraktudløb under selve skiftet.
//   - Grænse i fremtiden → gælder som før (#4004).
//   - Grænse passeret, skiftet ikke registreret som gennemført → gælder stadig
//     (skiftet er forsinket, typisk minutter til timer), men højst
//     SEASON_TRANSITION_OVERDUE_GRACE_MS. Derefter betragtes grænsen som en
//     efterladenskab, så en mistet log-skrivning aldrig kan lukke markedet igen.
export const SEASON_TRANSITION_EARLY_RUN_TOLERANCE_MS = 24 * 60 * 60 * 1000;
export const SEASON_TRANSITION_OVERDUE_GRACE_MS = 12 * 60 * 60 * 1000;

function toValidDate(value) {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Ren beslutning: hvilken grænse (hvis nogen) gælder for en ny auktion `now`?
 *
 * @param {{ plannedAt?: string|null, upcomingSeasonStartDate?: string|null,
 *           lastCompletedAt?: Date|string|null, inProgressSince?: Date|string|null,
 *           now?: Date }} inputs
 *   lastCompletedAt: seneste 'completed'-anker fra transition-fase-loggen.
 *   inProgressSince: seneste 'started'/'failed'-anker, KUN hvis nyere end lastCompletedAt.
 * @returns {Date|null}
 */
export function resolveActiveSeasonTransitionBoundary({
  plannedAt = null, upcomingSeasonStartDate = null, lastCompletedAt = null, inProgressSince = null, now = new Date(),
} = {}) {
  const nowMs = now.getTime();
  const running = toValidDate(inProgressSince);
  if (running && nowMs - running.getTime() < SEASON_TRANSITION_OVERDUE_GRACE_MS) {
    // Skiftet kører: spær alt. Grænsen = det tidligste af planlagt tid og starten.
    const planned = toValidDate(plannedAt);
    return planned && planned.getTime() < running.getTime() ? planned : running;
  }

  const completed = toValidDate(lastCompletedAt);
  const stillActive = (boundary) => {
    if (!boundary) return false;
    const b = boundary.getTime();
    if (completed && completed.getTime() >= b - SEASON_TRANSITION_EARLY_RUN_TOLERANCE_MS) return false;
    if (b > nowMs) return true;
    return nowMs - b < SEASON_TRANSITION_OVERDUE_GRACE_MS;
  };

  const explicit = computeSeasonTransitionBoundary({ plannedAt });
  if (stillActive(explicit)) return explicit;
  const derived = computeSeasonTransitionBoundary({ upcomingSeasonStartDate });
  if (stillActive(derived)) return derived;
  return null;
}

async function fetchTransitionPhaseAnchors(supabase) {
  try {
    const { data, error } = await supabase
      .from("admin_log")
      .select("created_at, meta")
      .eq("action_type", ADMIN_ACTION_TYPE.MANUAL_OVERRIDE)
      .eq("meta->>source", TRANSITION_PHASE_LOG_SOURCE)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error || !Array.isArray(data)) return { lastCompletedAt: null, inProgressSince: null };
    const lastCompleted = data.find((row) => row?.meta?.status === TRANSITION_PHASE_STATUS.COMPLETED);
    const latest = data[0];
    const inProgress = latest && latest !== lastCompleted && latest?.meta?.status !== TRANSITION_PHASE_STATUS.COMPLETED;
    return {
      lastCompletedAt: lastCompleted?.created_at ?? null,
      inProgressSince: inProgress ? latest.created_at : null,
    };
  } catch {
    // best-effort: uden log-ankre falder vi tilbage på tids-reglen (grace) ovenfor.
    return { lastCompletedAt: null, inProgressSince: null };
  }
}

/**
 * Henter grænsen fra DB og beslutter via resolveActiveSeasonTransitionBoundary.
 * Fail-open ved DB-fejl/manglende client — matcher den fail-open-retning den
 * oprindelige transfer_windows-baserede guard allerede havde ved en fejlet
 * opslag (ingen aktiv gate, ikke en 500).
 *
 * @param {object} supabase
 * @param {{ now?: Date }} [opts]
 * @returns {Promise<Date|null>}
 */
export async function fetchSeasonTransitionBoundary(supabase, { now = new Date() } = {}) {
  if (!supabase?.from) return null;
  try {
    const [{ data: cfg }, { data: season }, anchors] = await Promise.all([
      supabase.from("app_config").select("value").eq("key", SEASON_TRANSITION_PLANNED_AT_KEY).maybeSingle(),
      supabase.from("seasons").select("start_date").eq("status", "upcoming").maybeSingle(),
      fetchTransitionPhaseAnchors(supabase),
    ]);
    return resolveActiveSeasonTransitionBoundary({
      plannedAt: cfg?.value ?? null,
      upcomingSeasonStartDate: season?.start_date ?? null,
      lastCompletedAt: anchors.lastCompletedAt,
      inProgressSince: anchors.inProgressSince,
      now,
    });
  } catch {
    // best-effort: config-læsningen må aldrig vælte auktions-oprettelse (POST
    // /auctions, createGraduateAuction, listRejectedAsYouthAuction). Fail-open
    // i samme retning som den oprindelige transfer_windows-baserede guard havde
    // ved en fejlet opslag: ingen kendt grænse ⇒ ingen aktiv gate, ikke en 500.
    return null;
  }
}

// #4129 — nøglen er fremadrettet forberedt (se filhovedet), men blev ALDRIG sat af
// kode: kun manuelt via SQL på selve S2→S3-cutover-aftenen 23/8, og ryddet igen
// samme aften (docs/audits/2026-08-23-generalproeve-cutover.md §0). Guarden kørte
// derfor på det rene start_date-gæt hver eneste dag imellem. Denne skrivning gør
// gættet eksplicit PRÆCIS når det bliver relevant: når en kommende sæsons kalender
// oprettes/apply'es (buildSeasonCalendar.js --apply), ikke ved selve transitionen.
//
// Idempotent ON-CONFLICT-DO-UPDATE-semantik via upsert: skriver KUN når nøglen
// mangler, eller når den nuværende værdi er TIDLIGERE end målet — dvs. en
// efterladenskab fra en tidligere sæsons cutover, eller et skifte der ikke kan nås.
// En værdi der ligger SENERE end målet rører vi IKKE ved (#5592, diff-tjek 24/9): den
// er et bevidst senere skifte (eller en anomali), og begge dele skal et menneske se,
// ikke en stille overskrivning. Før #5592 blev en senere værdi der stadig lå før
// sæsonens start_date (fx 27/9 kl. 21 for en sæson der starter 28/9) overskrevet med
// konventionens kl. 18.
//
// `target` (#5592): det skifte kalenderen er planlagt mod (buildSeasonCalendar.js sender
// resolveEarliestSeasonTransition's værdi), så app_config og kalender aldrig kommer ud af
// trit. Uden `target` bruges konventionen (aftenen før start_date kl. 18), som før.
export async function ensureSeasonTransitionPlannedAt({ supabase, seasonStartDate, target: targetInput = null, now = new Date() } = {}) {
  if (!supabase?.from) return { updated: false, reason: "no-supabase" };

  let target;
  if (targetInput != null) {
    target = targetInput instanceof Date ? targetInput : new Date(targetInput);
    if (Number.isNaN(target.getTime())) throw new Error(`${SEASON_TRANSITION_PLANNED_AT_KEY}: target is not a valid timestamp: ${targetInput}`);
  } else {
    if (!seasonStartDate) return { updated: false, reason: "no-season-start-date" };
    target = computeSeasonTransitionBoundary({ upcomingSeasonStartDate: seasonStartDate });
    if (!target) return { updated: false, reason: "no-target" };
  }

  const { data: cfg, error: readErr } = await supabase
    .from("app_config")
    .select("value")
    .eq("key", SEASON_TRANSITION_PLANNED_AT_KEY)
    .maybeSingle();
  if (readErr) throw new Error(`could not read ${SEASON_TRANSITION_PLANNED_AT_KEY}: ${readErr.message}`);

  const existingRaw = cfg?.value ?? null;
  const existing = existingRaw ? new Date(existingRaw) : null;
  const existingValid = existing && !Number.isNaN(existing.getTime());

  if (existingValid && existing.getTime() === target.getTime()) {
    return { updated: false, reason: "already-correct", value: target.toISOString() };
  }
  if (existingValid && existing.getTime() > target.getTime()) {
    return { updated: false, reason: "existing-later-kept", existing: existingRaw, target: target.toISOString() };
  }

  const { error: writeErr } = await supabase.from("app_config").upsert(
    {
      key: SEASON_TRANSITION_PLANNED_AT_KEY,
      value: target.toISOString(),
      description:
        "Eksplicit planlagt tidspunkt for sæson-transitionen (#4004-guardens anker). " +
        "Sat automatisk af buildSeasonCalendar.js --apply til det skifte kalenderen er planlagt mod (#4129/#5592); " +
        "en senere værdi bevares. Sæt en senere værdi FØR kalenderen bygges, hvis cutover flyttes.",
      updated_at: now.toISOString(),
    },
    { onConflict: "key" }
  );
  if (writeErr) throw new Error(`kunne ikke skrive ${SEASON_TRANSITION_PLANNED_AT_KEY}: ${writeErr.message}`);

  return { updated: true, value: target.toISOString(), previous: existingRaw, reason: existingValid ? "stale" : "missing" };
}
