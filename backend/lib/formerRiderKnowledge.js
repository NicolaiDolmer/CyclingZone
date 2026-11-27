// #7455 (ejerens valg A 12/11, scope 27/11): viden om en rytter, holdet ikke har nu.
// Det dækker BÅDE (1) en tidligere rytter (solgt eller frigivet) OG (2) en rytter,
// holdet har scoutet uden at have ham på holdet.
//
// Holdet beholder sit gemte skøn (#6110, rider_potential_estimates). Resten af den
// sæson, holdet sidst lærte noget om rytteren, vises det uændret; derefter falder
// sikkerhedsordet ét trin pr. sæson til det laveste trin (reglerne: scouting.js).
// Faldet regnes ved visning, så intet gemt skøn skrives om, og en rytter, der kommer
// (tilbage) til holdet, straks er holdets egen igen.
//
// Hvornår holdet sidst lærte noget (ankeret), pr. rytter, det seneste af:
//   (1) afgangen fra holdet, læst fra rider_ownership_events: den seneste hændelse,
//       hvor holdet indgår, er en afgang. Kommer rytteren tilbage, er den seneste
//       hændelse en ankomst, og han er ikke længere tidligere rytter.
//   (2) holdets seneste kig (scout_actions.created_at). Et nyt kig er ny viden, så
//       det giver fuld viden resten af kiggets sæson, også for en tidligere rytter.
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
 * Seneste kig pr. rytter (sag 2). Ren funktion.
 *   actions : [{ rider_id, created_at }] (holdets scout_actions)
 * Returnerer Map<riderId, created_at>.
 */
export function latestLooks(actions) {
  const out = new Map();
  for (const action of actions ?? []) {
    if (!action?.rider_id || !action.created_at) continue;
    const prev = out.get(action.rider_id);
    if (!prev || Date.parse(action.created_at) > Date.parse(prev)) out.set(action.rider_id, action.created_at);
  }
  return out;
}

/**
 * Ankeret pr. rytter: det seneste af afgangen (sag 1) og det seneste kig (sag 2).
 * Ren funktion; begge input er Map<riderId, tidspunkt>.
 */
export function knowledgeAnchors(departures, looks) {
  const out = new Map(departures ?? []);
  for (const [riderId, lookedAt] of looks ?? []) {
    const prev = out.get(riderId);
    if (!prev || Date.parse(lookedAt) > Date.parse(prev)) out.set(riderId, lookedAt);
  }
  return out;
}

/**
 * Tabte trin pr. rytter, holdet ikke har nu. Ren funktion.
 *   departures : Map<riderId, tidspunkt> (knowledgeAnchors; navnet er historisk)
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
 * Tabte trin for de af `riderIds`, som er tidligere ryttere på holdet eller scoutet
 * af holdet. Tre små opslag: holdets ejerskabshændelser (indekseret på
 * from_team_id/to_team_id), holdets kig (indekseret på team_id, få hundrede pr. hold)
 * og sæsonerne. Returnerer en tom Map, når intet skal falde.
 */
export async function loadFormerRiderSteps(supabase, { teamId, riderIds, clock = new Date() }) {
  const wanted = new Set((riderIds ?? []).filter(Boolean));
  if (!teamId || !wanted.size) return new Map();
  const [events, actions, seasons] = await Promise.all([
    fetchAllRows(() => supabase
      .from("rider_ownership_events")
      .select("id, rider_id, from_team_id, to_team_id, occurred_at")
      .or(`from_team_id.eq.${teamId},to_team_id.eq.${teamId}`)
      .order("id")),
    fetchAllRows(() => supabase
      .from("scout_actions").select("id, rider_id, created_at").eq("team_id", teamId).order("id")),
    fetchAllRows(() => supabase.from("seasons").select("number, start_date, end_date").order("number")),
  ]);
  const anchors = knowledgeAnchors(
    latestDepartures(events.filter((event) => wanted.has(event.rider_id)), teamId),
    latestLooks(actions.filter((action) => wanted.has(action.rider_id))),
  );
  if (!anchors.size) return new Map();
  // Værn: en rytter, der står på holdet nu, er holdets egen, også hvis en ankomst
  // mangler i hændelserne (fx en ældre sti uden hændelse).
  const back = await fetchAllRowsChunkedIn([...anchors.keys()], (chunk) => supabase
    .from("riders").select("id, team_id").in("id", chunk).order("id"));
  for (const rider of back) if (rider.team_id === teamId) anchors.delete(rider.id);
  return formerRiderStepsFrom(anchors, seasons, copenhagenDateString(clock));
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
 * Rute-indgangen for én rytter (scouting-rapport og development-projection): læser
 * afgangen og kiggene og lægger faldet på svaret. Egne ryttere slår intet op.
 */
export async function withFormerRiderDecay(supabase, teamId, rider, own, report, { clock = new Date() } = {}) {
  if (own || !rider?.id || !report?.potentialView || report.potentialView.hidden) return report;
  const steps = await loadFormerRiderSteps(supabase, { teamId, riderIds: [rider.id], clock });
  return applyFormerRiderStepsToReport(report, steps.get(rider.id) ?? 0);
}

/**
 * Tidligere ryttere pr. hold, til engangs-backfill'en. Ren funktion.
 *   events      : alle ejerskabshændelser
 *   teamIds     : holdene der kan se et skøn (loadEstimateTeamIds)
 *   currentTeam : Map<riderId, team_id nu>; en rytter, der står på holdet nu, er ikke tidligere
 * Returnerer Map<teamId, riderId[]>, kun hold med mindst én tidligere rytter.
 */
export function formerRidersByTeam(events, teamIds, currentTeam) {
  const teams = new Set(teamIds ?? []);
  const byTeam = new Map();
  for (const event of events ?? []) {
    for (const teamId of [event?.from_team_id, event?.to_team_id]) {
      if (!teamId || !teams.has(teamId)) continue;
      if (!byTeam.has(teamId)) byTeam.set(teamId, []);
      byTeam.get(teamId).push(event);
    }
  }
  const out = new Map();
  for (const [teamId, teamEvents] of byTeam) {
    const gone = [...latestDepartures(teamEvents, teamId).keys()]
      .filter((riderId) => currentTeam?.get(riderId) !== teamId);
    if (gone.length) out.set(teamId, gone);
  }
  return out;
}
