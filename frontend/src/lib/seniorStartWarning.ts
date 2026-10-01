import { MIN_RACE_ENTRIES } from "./raceSelectionLogic.js";

interface TeamLike {
  user_id?: string | null;
  league_division_id?: string | number | null;
  is_ai?: boolean | null;
  is_bank?: boolean | null;
  is_frozen?: boolean | null;
  is_test_account?: boolean | null;
  parked_at?: string | null;
  retired_at?: string | null;
}

interface RiderLike {
  squad?: string | null;
  is_academy?: boolean | null;
  is_retired?: boolean | null;
}

export function computeSeniorStartWarning({
  team,
  riders,
}: {
  team: TeamLike | null | undefined;
  riders: readonly RiderLike[] | null | undefined;
}): { count: number; missing: number; min: number } | null {
  if (!team?.user_id || team.league_division_id == null || team.parked_at || team.retired_at) return null;
  if (team.is_ai || team.is_bank || team.is_frozen || team.is_test_account) return null;
  const count = (riders ?? []).filter((r) => r.squad === "senior" && r.is_academy === false && r.is_retired === false).length;
  if (count >= MIN_RACE_ENTRIES) return null;
  return { count, missing: MIN_RACE_ENTRIES - count, min: MIN_RACE_ENTRIES };
}
