// #6050: hvem hentede udbruddet. Ren afledning af tidslinje-events (ingen
// imports), delt af løbsfilmen (stageTimelineFilm.js), recappen (raceRecap.js)
// og etaperapporten, så de fortæller det samme. Eget lille modul, så recappen
// på forsiden ikke trækker hele film-logikken med i bundlen.

export type TimelineEvent = { km?: number; type?: string; params?: Record<string, unknown> | null } | null | undefined;
export type TeamNameLookup = { get(id: string): string | undefined } | null | undefined;
export type CatchActor =
  | { kind: "teams"; teams: string; km: number | null }
  | { kind: "peloton"; km: number | null };
export type CatchActorCopy = { key: string; params: Record<string, string | number> };

function idsOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Indhentningen af DAGENS udbrud (morgen-formationen), ikke et senere angreb.
 * Samme udvælgelse som filmens catch-punkt. Ingen formation → første catch.
 */
export function findMorningCatch(events: readonly TimelineEvent[] | null | undefined = []): TimelineEvent | null {
  const sorted = [...(events || [])].sort((a, b) => (a?.km ?? 0) - (b?.km ?? 0));
  const formation = sorted.find((e) => e?.type === "breakaway_formed");
  const morningIds = new Set(idsOf(formation?.params?.rider_ids));
  const formationGroup = formation?.params?.group_id;
  return sorted.find((e) => e?.type === "breakaway_caught"
    && (!formation || idsOf(e.params?.rider_ids).some((id) => morningIds.has(id)))
    && (!formationGroup || !e.params?.group_id || e.params.group_id === formationGroup)) ?? null;
}

/**
 * Læser KUN det motoren skrev på eventet (`chasing_team_ids`,
 * `chase_group_kind`, v4 fra #6050). Ældre tidslinjer har ingen af felterne
 * → null, og kaldestedet beholder den gamle tekst. Aldrig opfundet aktør.
 * - "teams": holdene med jagt-arbejde, når mindst ét navn kan slås op.
 * - "peloton": jagt-gruppen var feltet, men intet hold havde jagt-ordre.
 * `km` = hele km til mål, når mindst 1 (ellers null, fx hentet på stregen).
 */
export function catchActor(
  event: TimelineEvent,
  { teamNameById, distanceKm = null }: { teamNameById?: TeamNameLookup; distanceKm?: number | null } = {},
): CatchActor | null {
  const p = event?.params || {};
  const teams = idsOf(p.chasing_team_ids)
    .map((id) => (id == null ? null : teamNameById?.get?.(String(id)) || null))
    .filter((name): name is string => Boolean(name));
  const eventKm = event?.km;
  const kmToGo = Number.isFinite(distanceKm) && Number.isFinite(eventKm) ? Math.round((distanceKm as number) - (eventKm as number)) : null;
  const km = kmToGo != null && kmToGo >= 1 ? kmToGo : null;
  if (teams.length) return { kind: "teams", teams: teams.join(", "), km };
  if (p.chase_group_kind === "peloton") return { kind: "peloton", km };
  return null;
}

/** Etapens længde fra tidslinjen selv (stage_start, ellers finish-km). */
export function timelineDistanceKm(events: readonly TimelineEvent[] | null | undefined = []): number | null {
  const start = (events || []).find((e) => e?.type === "stage_start");
  const d = Number(start?.params?.distance_km);
  if (Number.isFinite(d) && d > 0) return d;
  const finishKm = (events || []).find((e) => e?.type === "finish")?.km;
  return Number.isFinite(finishKm) ? (finishKm as number) : null;
}

const RECAP_KEY = { teams: "breakawayCaughtByTeams", peloton: "breakawayCaughtByPeloton" } as const;
const BEAT_KEY = { teams: "breakaway_caught_by_teams", peloton: "breakaway_caught_by_peloton" } as const;

/**
 * Nøgle + params for en aktør-linje i recap ("recap") eller rapport ("beat").
 * null når tidslinjen ikke navngiver aktøren.
 */
export function catchActorCopy(
  timelineEvents: readonly TimelineEvent[] | null | undefined,
  { teamNameById, family = "recap", count = 0 }: { teamNameById?: TeamNameLookup; family?: "recap" | "beat"; count?: number } = {},
): CatchActorCopy | null {
  const event = timelineEvents?.length ? findMorningCatch(timelineEvents) : null;
  const actor = event ? catchActor(event, { teamNameById, distanceKm: timelineDistanceKm(timelineEvents) }) : null;
  if (!actor) return null;
  // Én nøgle pr. aktør; `where` vælger "med N km igen" / "før stregen" i ICU-teksten.
  const where = actor.km == null ? { where: "line" } : { where: "km", km: actor.km };
  const params: Record<string, string | number> = actor.kind === "teams"
    ? { count, teams: actor.teams, ...where }
    : { count, ...where };
  return { key: (family === "beat" ? BEAT_KEY : RECAP_KEY)[actor.kind], params };
}
