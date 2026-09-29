// Read-only mirror of the service-only SQL replacement guards (#4753).
// The planner never calls Supabase or mutates input rows. Exact target/candidate
// identities belong in private dry-run output, not public PR text.
import { MIN_RACE_ENTRIES } from "./raceAutopick.js";

export const YOUTH_GROUP_SIZE = 24;

export function isSafeYouthReplacement(team) {
  return !!team
    && team.is_ai === true
    && team.user_id == null
    && team.is_bank === false
    && team.is_frozen === false
    && team.is_test_account === false
    && team.parked_at == null
    && team.retired_at == null
    && team.pending_removal_at == null
    && team.league_division_id != null
    && team.u23_league_division_id == null
    && team.junior_league_division_id == null
    && Number(team.u23Riders) >= MIN_RACE_ENTRIES
    && Number(team.juniorRiders) >= MIN_RACE_ENTRIES
    && Number(team.futureYouthEntries) === 0;
}

export function planYouthPoolReplacements({ targets = [], candidates = [], groupCounts = new Map() } = {}) {
  const available = candidates.filter(isSafeYouthReplacement)
    .sort((a, b) => String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0);
  const repairs = [];
  const blockers = [];
  const orderedTargets = [...targets].sort((a, b) =>
    Number(a.retired_at == null) - Number(b.retired_at == null)
    || String(a.id).localeCompare(String(b.id)));

  for (const target of orderedTargets) {
    const groups = [target.u23_league_division_id, target.junior_league_division_id].filter((id) => id != null);
    const block = (reason) => blockers.push({ targetId: target.id, reason, groups });
    if (target.is_ai !== true || target.user_id != null) { block("not_ai"); continue; }
    if (!groups.length) { block("no_youth_groups"); continue; }
    if (groups.some((id) => groupCounts.get(id) !== YOUTH_GROUP_SIZE)) { block("group_size_changed"); continue; }
    if (target.retired_at != null && Number(target.futureEntries ?? 0) > 0) {
      block("unfinished_target_entries"); continue;
    }
    if (target.retired_at == null && target.pending_removal_at == null) {
      block("target_not_retiring"); continue;
    }
    const replacement = available.shift();
    if (!replacement) { block("no_safe_youth_replacement"); continue; }
    const lastScheduledAt = (target.blockingRaces ?? [])
      .map((race) => race.lastScheduledAt)
      .filter(Boolean)
      .sort()
      .at(-1) ?? null;
    repairs.push({
      targetId: target.id,
      replacementId: replacement.id,
      groups,
      when: target.retired_at != null ? "owner_go_now" : lastScheduledAt ? "after_last_race" : "on_retirement",
      lastScheduledAt,
      candidateU23Riders: replacement.u23Riders,
      candidateJuniorRiders: replacement.juniorRiders,
    });
  }

  return { repairs, blockers, eligibleCandidateCount: candidates.filter(isSafeYouthReplacement).length };
}
