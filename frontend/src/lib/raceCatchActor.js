// #6050: hvem hentede udbruddet. Ren afledning af tidslinje-events (ingen
// imports), delt af løbsfilmen (stageTimelineFilm.js), recappen (raceRecap.js)
// og etaperapporten, så de fortæller det samme. Eget lille modul, så recappen
// på forsiden ikke trækker hele film-logikken med i bundlen.

/**
 * Indhentningen af DAGENS udbrud (morgen-formationen), ikke et senere angreb.
 * Samme udvælgelse som filmens catch-punkt. Ingen formation → første catch.
 */
export function findMorningCatch(events = []) {
  const sorted = [...(events || [])].sort((a, b) => (a?.km ?? 0) - (b?.km ?? 0));
  const formation = sorted.find((e) => e?.type === "breakaway_formed");
  const morningIds = new Set(formation?.params?.rider_ids ?? []);
  return sorted.find((e) => e?.type === "breakaway_caught"
    && (!formation || (e.params?.rider_ids ?? []).some((id) => morningIds.has(id)))
    && (!formation?.params?.group_id || !e.params?.group_id || e.params.group_id === formation.params.group_id)) ?? null;
}

/**
 * Læser KUN det motoren skrev på eventet (`chasing_team_ids`,
 * `chase_group_kind`, v4 fra #6050). Ældre tidslinjer har ingen af felterne
 * → null, og kaldestedet beholder den gamle tekst. Aldrig opfundet aktør.
 * - "teams": holdene med jagt-arbejde, når mindst ét navn kan slås op.
 * - "peloton": jagt-gruppen var feltet, men intet hold havde jagt-ordre.
 * `km` = hele km til mål, når mindst 1 (ellers null, fx hentet på stregen).
 */
export function catchActor(event, { teamNameById, distanceKm = null } = {}) {
  const p = event?.params || {};
  const ids = Array.isArray(p.chasing_team_ids) ? p.chasing_team_ids : [];
  const teams = ids.map((id) => (id == null ? null : teamNameById?.get?.(String(id)) || null)).filter(Boolean);
  const kmToGo = Number.isFinite(distanceKm) && Number.isFinite(event?.km) ? Math.round(distanceKm - event.km) : null;
  const km = kmToGo != null && kmToGo >= 1 ? kmToGo : null;
  if (teams.length) return { kind: "teams", teams: teams.join(", "), teamCount: teams.length, km };
  if (p.chase_group_kind === "peloton") return { kind: "peloton", km };
  return null;
}

/** Etapens længde fra tidslinjen selv (stage_start, ellers finish-km). */
export function timelineDistanceKm(events = []) {
  const start = (events || []).find((e) => e?.type === "stage_start");
  const d = Number(start?.params?.distance_km);
  if (Number.isFinite(d) && d > 0) return d;
  const finish = (events || []).find((e) => e?.type === "finish");
  return Number.isFinite(finish?.km) ? finish.km : null;
}

const RECAP_KEY = { teams: "breakawayCaughtByTeams", peloton: "breakawayCaughtByPeloton" };
const BEAT_KEY = { teams: "breakaway_caught_by_teams", peloton: "breakaway_caught_by_peloton" };

/**
 * Nøgle-suffiks + params for en aktør-linje i recap ("recap") eller rapport
 * ("beat"). null når tidslinjen ikke navngiver aktøren.
 */
export function catchActorCopy(timelineEvents, { teamNameById, family = "recap", count = 0 } = {}) {
  const event = timelineEvents?.length ? findMorningCatch(timelineEvents) : null;
  const actor = event ? catchActor(event, { teamNameById, distanceKm: timelineDistanceKm(timelineEvents) }) : null;
  if (!actor) return null;
  const base = (family === "beat" ? BEAT_KEY : RECAP_KEY)[actor.kind];
  const params = actor.kind === "teams" ? { count, teams: actor.teams, teamCount: actor.teamCount } : { count };
  if (actor.km == null) return { key: base, params };
  return { key: family === "beat" ? `${base}_km` : `${base}Km`, params: { ...params, km: actor.km } };
}
