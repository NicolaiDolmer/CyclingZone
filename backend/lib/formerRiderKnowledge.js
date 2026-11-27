// #7455 (ejerens valg A 12/11): viden om en rytter, der har forladt holdet.
//
// Holdet beholder sit gemte skøn (#6110, rider_potential_estimates) om en tidligere
// rytter. Resten af afgangssæsonen vises det uændret; derefter falder sikkerhedsordet
// ét trin pr. sæson til det laveste trin (reglerne: scouting.js). Faldet regnes ved
// visning, så intet gemt skøn skrives om, og en rytter, der kommer tilbage, straks
// er holdets egen igen.
//
// Afgangen læses fra rider_ownership_events: den seneste hændelse, hvor holdet indgår,
// er en afgang fra holdet. Kommer rytteren tilbage, er den seneste hændelse en
// ankomst, og han er ikke længere tidligere rytter.
//
// Kobling (bevidst ikke i potentialEstimateRead.js, som et andet spor ejer): ruterne
// lægger faldet på svaret fra buildEstimatesFromViews / buildScoutingReportFromView /
// buildProjectionFromView. Kun sikkerhedsordet (og rapportens tillid, som skal sige
// det samme som ordet) ændres; tal, "ændret siden sidst" og alt andet står.

import { fetchAllRows, fetchAllRowsChunkedIn } from "./supabasePagination.js";
import { copenhagenDateString } from "./copenhagenTime.js";
import {
  currentSeasonNumber, decayFormerRiderView, departureSeasonNumber, formerRiderStepsLost,
} from "./scouting.js";

// Samme oversættelse som rapportens vurdering i potentialEstimateRead.js: tilliden
// må aldrig påstå en anden sikkerhed end ordet ved tallet.
const VERDICT_CONFIDENCE = Object.freeze({ sure: "high", fair: "medium", unsure: "low" });

/**
 * Seneste afgang fra holdet pr. rytter, der stadig er væk. Ren funktion.
 *   events : [{ rider_id, from_team_id, to_team_id, occurred_at }] hvor holdet indgår
 * Returnerer Map<riderId, occurred_at> for ryttere, hvis seneste hændelse med holdet
 * er en afgang fra det.
 */
export function latestDepartures(events, teamId) {
  const latest = new Map();
  for (const event of events ?? []) {
    if (!event?.rider_id || !event.occurred_at) continue;
    if (event.from_team_id === event.to_team_id) continue;
    if (event.from_team_id !== teamId && event.to_team_id !== teamId) continue;
    const prev = latest.get(event.rider_id);
    if (!prev || Date.parse(event.occurred_at) >= Date.parse(prev.occurred_at)) latest.set(event.rider_id, event);
  }
  const out = new Map();
  for (const [riderId, event] of latest) if (event.from_team_id === teamId) out.set(riderId, event.occurred_at);
  return out;
}

/**
 * Tabte trin pr. tidligere rytter. Ren funktion.
 *   departures : Map<riderId, occurred_at> (latestDepartures)
 *   seasons    : [{ number, start_date, end_date }]
 *   today      : YYYY-MM-DD (København)
 * Kun ryttere med mindst ét tabt trin er med i resultatet.
 */
export function formerRiderStepsFrom(departures, seasons, today) {
  const current = currentSeasonNumber(today, seasons);
  const steps = new Map();
  if (current == null) return steps;
  for (const [riderId, occurredAt] of departures ?? []) {
    const leftOn = copenhagenDateString(new Date(occurredAt));
    const lost = formerRiderStepsLost(departureSeasonNumber(leftOn, seasons), current);
    if (lost > 0) steps.set(riderId, lost);
  }
  return steps;
}

/**
 * Tabte trin for de af `riderIds`, som er tidligere ryttere på holdet.
 * To små opslag: holdets ejerskabshændelser (indekseret på from_team_id/to_team_id,
 * og få pr. hold) og sæsonerne. Returnerer en tom Map, når intet skal falde.
 */
export async function loadFormerRiderSteps(supabase, { teamId, riderIds, clock = new Date() }) {
  const wanted = new Set((riderIds ?? []).filter(Boolean));
  if (!teamId || !wanted.size) return new Map();
  const [events, seasons] = await Promise.all([
    fetchAllRows(() => supabase
      .from("rider_ownership_events")
      .select("id, rider_id, from_team_id, to_team_id, occurred_at")
      .or(`from_team_id.eq.${teamId},to_team_id.eq.${teamId}`)
      .order("id")),
    fetchAllRows(() => supabase.from("seasons").select("number, start_date, end_date").order("number")),
  ]);
  const departures = latestDepartures(events.filter((event) => wanted.has(event.rider_id)), teamId);
  if (!departures.size) return new Map();
  // Værn: en rytter, der står på holdet nu, er holdets egen, også hvis en ankomst
  // mangler i hændelserne (fx en ældre sti uden hændelse).
  const back = await fetchAllRowsChunkedIn([...departures.keys()], (chunk) => supabase
    .from("riders").select("id, team_id").in("id", chunk).order("id"));
  for (const rider of back) if (rider.team_id === teamId) departures.delete(rider.id);
  return formerRiderStepsFrom(departures, seasons, copenhagenDateString(clock));
}

/** Svaret fra buildEstimatesFromViews med faldet lagt på. Ny objekt; input røres ikke. */
export function applyFormerRiderStepsToEstimates(estimates, steps) {
  if (!steps?.size) return estimates;
  const out = {};
  for (const [riderId, entry] of Object.entries(estimates ?? {})) {
    const lost = steps.get(riderId);
    out[riderId] = lost && entry?.potentialView
      ? { ...entry, potentialView: decayFormerRiderView(entry.potentialView, lost) }
      : entry;
  }
  return out;
}

/** Svaret fra buildScoutingReportFromView / buildProjectionFromView for én rytter. */
export function applyFormerRiderStepsToReport(report, stepsLost) {
  if (!report?.potentialView || !(stepsLost > 0)) return report;
  const potentialView = decayFormerRiderView(report.potentialView, stepsLost);
  if (potentialView === report.potentialView) return report;
  const out = { ...report, potentialView };
  if (report.verdict && VERDICT_CONFIDENCE[potentialView.certainty]) {
    out.verdict = { ...report.verdict, confidence: VERDICT_CONFIDENCE[potentialView.certainty] };
  }
  return out;
}

/**
 * Par (tidligere hold, rytter) uden gemt skøn, til engangs-backfill'en. Ren funktion.
 *   departuresByTeam : Map<teamId, Set<riderId>> tidligere ryttere pr. menneskehold
 *   storedPairs      : Set<"riderId:teamId"> par, der allerede har en række
 * Returnerer Map<teamId, riderId[]>.
 */
export function missingFormerPairs(departuresByTeam, storedPairs) {
  const out = new Map();
  for (const [teamId, riderIds] of departuresByTeam ?? []) {
    const missing = [...riderIds].filter((riderId) => !storedPairs.has(`${riderId}:${teamId}`));
    if (missing.length) out.set(teamId, missing);
  }
  return out;
}
