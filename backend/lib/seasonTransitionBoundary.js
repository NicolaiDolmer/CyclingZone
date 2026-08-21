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

/**
 * Henter grænsen fra DB og beregner den via computeSeasonTransitionBoundary.
 * Fail-open ved DB-fejl/manglende client — matcher den fail-open-retning den
 * oprindelige transfer_windows-baserede guard allerede havde ved en fejlet
 * opslag (ingen aktiv gate, ikke en 500).
 *
 * @param {object} supabase
 * @returns {Promise<Date|null>}
 */
export async function fetchSeasonTransitionBoundary(supabase) {
  if (!supabase?.from) return null;
  try {
    const [{ data: cfg }, { data: season }] = await Promise.all([
      supabase.from("app_config").select("value").eq("key", SEASON_TRANSITION_PLANNED_AT_KEY).maybeSingle(),
      supabase.from("seasons").select("start_date").eq("status", "upcoming").maybeSingle(),
    ]);
    return computeSeasonTransitionBoundary({
      plannedAt: cfg?.value ?? null,
      upcomingSeasonStartDate: season?.start_date ?? null,
    });
  } catch {
    // best-effort: config-læsningen må aldrig vælte auktions-oprettelse (POST
    // /auctions, createGraduateAuction, listRejectedAsYouthAuction). Fail-open
    // i samme retning som den oprindelige transfer_windows-baserede guard havde
    // ved en fejlet opslag: ingen kendt grænse ⇒ ingen aktiv gate, ikke en 500.
    return null;
  }
}
