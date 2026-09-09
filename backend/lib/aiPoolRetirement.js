import { fetchAllRows } from './supabasePagination.js';
import { retireAiTeam } from './aiTeamRetirement.js';
import { getStalledInflightRaceIds, teamInflightRaceIds } from './aiTeamRaceObligations.js';

export async function planPoolRetirements(supabase, poolId, now) {
  const { data, error } = await supabase.rpc('plan_ai_pool_retirements', {
    p_pool_id: poolId, p_now: now.toISOString(),
  });
  if (error) throw new Error(`AI pool ${poolId} plan: ${error.message}`);
  if (!Array.isArray(data)) throw new Error(`AI pool ${poolId} plan: invalid response`);
  return data;
}

export async function reservePoolRetirements(supabase, poolId, now) {
  const { data, error } = await supabase.rpc('reserve_ai_pool_retirements', {
    p_pool_id: poolId, p_now: now.toISOString(),
  });
  if (error) throw new Error(`AI pool ${poolId} reserve: ${error.message}`);
  if (!Number.isInteger(data?.reserved) || data.reserved < 0
    || !Number.isInteger(data?.cleared) || data.cleared < 0) throw new Error(`AI pool ${poolId} reserve: invalid response`);
  return data;
}

export async function retireExcessAiTeamsForPool(supabase, poolId, now = new Date()) {
  await reservePoolRetirements(supabase, poolId, now);
  const plan = await planPoolRetirements(supabase, poolId, now);
  let removed = 0;
  for (const candidate of plan) {
    if (candidate.reason) continue;
    const result = await retireAiTeam(supabase, candidate.team_id, { now });
    // The transaction may legitimately defer after a concurrent state change.
    if (result.retired) removed += 1;
  }
  return removed;
}

// Every pool is inspected, including healthy pools with obsolete reservations
// and overfull pools that never received a reservation. No dependence on signup.
export async function runAiPoolRetirementSweep({ supabase, now, backstopHours,
  getStalledIds = getStalledInflightRaceIds, teamBlockingRaceIds = teamInflightRaceIds }) {
  const pools = await fetchAllRows(() => supabase.from('league_divisions').select('id').order('id'));
  const result = { candidates: 0, healed: 0, failed: 0, cleared: 0, guard: [], stale: [], errors: [] };
  const stalledIds = new Set(await getStalledIds(supabase, now));
  for (const pool of pools) {
    try {
      const reservation = await reservePoolRetirements(supabase, pool.id, now);
      result.cleared += reservation.cleared;
      if (reservation.cleared) result.guard.push({poolId:pool.id,reason:'obsolete_reservations',cleared:reservation.cleared});
      const plan = await planPoolRetirements(supabase, pool.id, now);
      result.candidates += plan.length;
      for (const c of plan) {
        const ageHours = (now.getTime() - new Date(c.blocked_since ?? c.pending_since).getTime()) / 3_600_000;
        try {
          if (c.reason) {
            const stalled = c.reason === 'inflight_entries' && stalledIds.size > 0
              ? (await teamBlockingRaceIds(supabase, c.team_id, [...stalledIds])) : [];
            if (stalled.length) {
              result.stale.push({ teamId: c.team_id, poolId: pool.id, reason: 'blocking_race_stalled',
                blockKind: c.reason, raceIds: stalled, ageHours, blockedSince: c.blocked_since });
            } else if (!Number.isFinite(ageHours) || ageHours >= backstopHours) {
              result.stale.push({ teamId: c.team_id, poolId: pool.id, reason: 'pending_exceeds_backstop',
                blockKind: c.reason, ageHours, pendingSince: c.pending_since, blockedSince: c.blocked_since });
            }
            continue;
          }
          const retired = await retireAiTeam(supabase, c.team_id, { now });
          if (retired.retired) result.healed += 1;
          else if (['not_excess','not_active_ai','pool_changed'].includes(retired.reason)) {
            result.guard.push({teamId:c.team_id,poolId:pool.id,reason:retired.reason});
          }
        } catch (error) {
          // best-effort per team: return errors to cron's Sentry aggregation;
          // persistent failures use its deduplicated stale alert (#4594).
          if (Number.isFinite(ageHours) && ageHours >= backstopHours) {
            result.stale.push({teamId:c.team_id,poolId:pool.id,reason:'error_exceeds_backstop',
              ageHours,message:error.message,blockedSince:c.blocked_since});
          } else {
            result.failed += 1;
            result.errors.push({teamId:c.team_id,poolId:pool.id,message:error.message});
          }
        }
      }
    } catch (error) {
      // best-effort per pool: failures are returned and captured by cron;
      // no candidate can be retired when reservation/planning failed.
      result.failed += 1;
      result.errors.push({ poolId: pool.id, message: error.message });
    }
  }
  return result;
}
