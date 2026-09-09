// #4753: every pool is reconciled through the atomic retirement contract.
// A disabled/unavailable flag pauses removal; never fall back to hard deletion.
import { runAiPoolRetirementSweep } from './aiPoolRetirement.js';
import { isAiTeamRetireEnabled } from './aiTeamRetireFlag.js';

// Existing #2434/#4828 bound; current blocker age, not a superseded reason.
export const STALE_BACKSTOP_HOURS = 120;

export async function runAiTeamTrimHealSweep({
  supabase, now = new Date(), backstopHours = STALE_BACKSTOP_HOURS,
  isRetireEnabled = isAiTeamRetireEnabled,
} = {}) {
  if (!supabase?.from) throw new Error('Supabase client required');
  if (!await isRetireEnabled(supabase)) {
    return { candidates: 0, healed: 0, failed: 0, cleared: 0, guard: [], stale: [], errors: [], paused: true };
  }
  return runAiPoolRetirementSweep({ supabase, now, backstopHours });
}
