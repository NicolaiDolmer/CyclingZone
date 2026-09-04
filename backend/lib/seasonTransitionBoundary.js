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

// #4129 — nøglen er fremadrettet forberedt (se filhovedet), men blev ALDRIG sat af
// kode: kun manuelt via SQL på selve S2→S3-cutover-aftenen 23/8, og ryddet igen
// samme aften (docs/audits/2026-08-23-generalproeve-cutover.md §0). Guarden kørte
// derfor på det rene start_date-gæt hver eneste dag imellem. Denne skrivning gør
// gættet eksplicit PRÆCIS når det bliver relevant: når en kommende sæsons kalender
// oprettes/apply'es (buildSeasonCalendar.js --apply), ikke ved selve transitionen.
//
// Idempotent ON-CONFLICT-DO-UPDATE-semantik via upsert: skriver KUN når nøglen
// mangler, eller når den nuværende værdi er ÆLDRE end den nye sæsons start_date —
// dvs. tydeligvis en efterladenskab fra en TIDLIGERE sæsons cutover, ikke et
// bevidst sat tidspunkt for netop denne sæson. En værdi der allerede ligger på
// eller efter den nye sæsons start_date rører vi IKKE ved: den kan ikke være vores
// egen beregning (den ligger altid FØR start_date), så den er enten en bevidst
// afvigende ejer-indsat værdi eller en anomali — begge dele skal et menneske se,
// ikke en stille overskrivning.
export async function ensureSeasonTransitionPlannedAt({ supabase, seasonStartDate, now = new Date() } = {}) {
  if (!supabase?.from) return { updated: false, reason: "no-supabase" };
  if (!seasonStartDate) return { updated: false, reason: "no-season-start-date" };

  const target = computeSeasonTransitionBoundary({ upcomingSeasonStartDate: seasonStartDate });
  if (!target) return { updated: false, reason: "no-target" };

  const { data: cfg, error: readErr } = await supabase
    .from("app_config")
    .select("value")
    .eq("key", SEASON_TRANSITION_PLANNED_AT_KEY)
    .maybeSingle();
  if (readErr) throw new Error(`kunne ikke læse ${SEASON_TRANSITION_PLANNED_AT_KEY}: ${readErr.message}`);

  const existingRaw = cfg?.value ?? null;
  const existing = existingRaw ? new Date(existingRaw) : null;
  const existingValid = existing && !Number.isNaN(existing.getTime());
  const seasonStart = new Date(`${String(seasonStartDate).slice(0, 10)}T00:00:00Z`);

  if (existingValid && existing.getTime() === target.getTime()) {
    return { updated: false, reason: "already-correct", value: target.toISOString() };
  }
  if (existingValid && existing.getTime() >= seasonStart.getTime()) {
    return { updated: false, reason: "existing-value-not-stale", existing: existingRaw };
  }

  const { error: writeErr } = await supabase.from("app_config").upsert(
    {
      key: SEASON_TRANSITION_PLANNED_AT_KEY,
      value: target.toISOString(),
      description:
        "Eksplicit planlagt tidspunkt for sæson-transitionen (#4004-guardens anker). " +
        "Sat automatisk af buildSeasonCalendar.js --apply ved sæson-oprettelse (#4129); " +
        "overskriv manuelt hvis cutover flyttes.",
      updated_at: now.toISOString(),
    },
    { onConflict: "key" }
  );
  if (writeErr) throw new Error(`kunne ikke skrive ${SEASON_TRANSITION_PLANNED_AT_KEY}: ${writeErr.message}`);

  return { updated: true, value: target.toISOString(), previous: existingRaw, reason: existingValid ? "stale" : "missing" };
}
