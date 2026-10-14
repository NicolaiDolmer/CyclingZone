import { deriveRaceStatus } from "../raceHubLogic.js";
import type {
  RawRace,
  LibrarySeason,
  LibraryStage,
  LibraryProfile,
  LibraryResult,
  RaceEditionSummary,
  LibraryQuery,
} from "./types.ts";
const ARTICLES = new Set(["de", "del", "della", "du", "des", "d", "l", "la", "le", "les"]);
export function normalizeRaceSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter((word) => !ARTICLES.has(word))
    .join("");
}
export function matchesRaceSearch(name: string, query: string): boolean {
  return normalizeRaceSearch(name).includes(normalizeRaceSearch(query));
}
// Exact persisted spelling is deliberately distinct from the forgiving search index.
export function raceFamilyKey<T extends Pick<RawRace, "name" | "race_type">>(race: T): string {
  return JSON.stringify([race.name, race.race_type]);
}
export function summariseRace(
  race: RawRace,
  season: LibrarySeason,
  schedule: LibraryStage[],
  profiles: LibraryProfile[],
  results: LibraryResult[]
): RaceEditionSummary {
  const derived = deriveRaceStatus(race.status, race.stages_completed, race.stages);
  const status =
    derived === "scheduled" || derived === "live" || derived === "completed" ? derived : "unknown";
  const stages = race.stages && race.stages > 0 ? race.stages : 1;
  const dates = schedule
    .map((row) => row.scheduled_at)
    .filter((value) => Number.isFinite(Date.parse(value)))
    .sort();
  const days = schedule
    .map((row) => row.game_day)
    .filter((day): day is number => typeof day === "number" && Number.isFinite(day));
  const profileMap = new Map(profiles.map((row) => [row.stage_number, row.distance_km]));
  const distances = Array.from({ length: stages }, (_, i) => profileMap.get(i + 1));
  const distanceKm = distances.every(
    (d): d is number => typeof d === "number" && Number.isFinite(d) && d > 0
  )
    ? distances.reduce((total, d) => total + d, 0)
    : null;
  const resultType = race.race_type === "stage_race" ? "gc" : "stage";
  const final =
    status === "completed"
      ? results
          .filter((r) => r.race_id === race.id && r.result_type === resultType && r.rank === 1)
          .sort((a, b) => (b.stage_number ?? 0) - (a.stage_number ?? 0))[0]
      : undefined;
  return {
    id: race.id,
    name: race.name,
    familyKey: raceFamilyKey(race),
    raceType: race.race_type,
    raceClass: race.race_class ?? null,
    seasonId: season.id,
    seasonNumber: season.number,
    poolId: race.league_division_id,
    stages,
    status,
    startAt: dates[0] ?? race.scheduled_for ?? null,
    endAt: dates.at(-1) ?? race.scheduled_for ?? null,
    firstGameDay: days.length ? Math.min(...days) : (race.game_day_start ?? null),
    lastGameDay: days.length ? Math.max(...days) : null,
    distanceKm,
    winner: final?.rider_name
      ? {
          name: final.rider_name,
          riderId: final.rider_id ?? null,
          teamName: final.team_name ?? null,
        }
      : null,
  };
}
export function filterLibrary(
  rows: RaceEditionSummary[],
  query: LibraryQuery
): RaceEditionSummary[] {
  return rows
    .filter((row) =>
      query.tab === "history"
        ? row.status === "completed"
        : row.status === "scheduled" || row.status === "live"
    )
    .filter(
      (row) =>
        matchesRaceSearch(row.name, query.search) &&
        (query.raceType === "all" || row.raceType === query.raceType) &&
        (query.raceClass === "all" || row.raceClass === query.raceClass)
    )
    .sort((a, b) => {
      if (query.tab === "upcoming" && (a.status === "live") !== (b.status === "live"))
        return a.status === "live" ? -1 : 1;
      const aTime = Date.parse((query.tab === "history" ? a.endAt : a.startAt) ?? "");
      const bTime = Date.parse((query.tab === "history" ? b.endAt : b.startAt) ?? "");
      if (Number.isFinite(aTime) !== Number.isFinite(bTime)) return Number.isFinite(aTime) ? -1 : 1;
      const delta = Number.isFinite(aTime) && Number.isFinite(bTime) ? aTime - bTime : 0;
      return (
        (query.tab === "history" ? -delta : delta) ||
        a.name.localeCompare(b.name) ||
        a.id.localeCompare(b.id)
      );
    });
}
