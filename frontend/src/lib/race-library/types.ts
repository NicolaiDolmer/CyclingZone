export interface LibrarySeason {
  id: string;
  number: number;
  status: string | null;
}
export interface LibraryPool {
  id: number;
  tier: number;
  pool_index: number;
  label: string | null;
  retired_at?: string | null;
}
export interface LibraryScope {
  seasonId: string;
  tier: number | null;
  poolId: number | null;
  squad: "senior";
}
export interface LibraryQuery {
  tab: "upcoming" | "history";
  search: string;
  raceType: string;
  raceClass: string;
}
export interface RawRace {
  id: string;
  name: string;
  race_type: string | null;
  race_class?: string | null;
  stages: number | null;
  stages_completed: number | null;
  status: string | null;
  season_id: string;
  league_division_id: number | null;
  pool_race_id: string | null;
  edition_year: number | null;
  squad?: string | null;
  scheduled_for?: string | null;
  game_day_start?: number | null;
}
export interface LibraryStage {
  race_id?: string;
  stage_number: number;
  scheduled_at: string;
  game_day: number | null;
}
export interface LibraryProfile {
  race_id?: string;
  stage_number: number;
  distance_km: number | null;
  profile_type?: string | null;
  elevation_gain_m?: number | null;
  elevation_profile?: unknown;
  sectors?: unknown;
  climbs?: unknown;
}
export interface LibraryResult {
  id?: string;
  race_id: string;
  stage_number: number | null;
  result_type: string;
  rank: number | null;
  rider_id?: string | null;
  rider_name?: string | null;
  team_id?: string | null;
  team_name?: string | null;
  points_earned?: number | null;
}
export interface RaceEditionSummary {
  id: string;
  name: string;
  familyKey: string;
  raceType: string | null;
  raceClass: string | null;
  seasonId: string;
  seasonNumber: number;
  poolId: number | null;
  stages: number;
  status: "scheduled" | "live" | "completed" | "unknown";
  startAt: string | null;
  endAt: string | null;
  firstGameDay: number | null;
  lastGameDay: number | null;
  distanceKm: number | null;
  winner: { name: string; riderId: string | null; teamName: string | null } | null;
}
export interface RaceEditionDetail {
  summary: RaceEditionSummary;
  schedule: LibraryStage[];
  profiles: LibraryProfile[];
}
