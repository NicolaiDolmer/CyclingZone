#!/usr/bin/env node
// Read-only by default. Apply needs --apply --owner-go --team=<dry-run UUID>.
// One team per invocation; no automatic chain of production mutations.
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchAllRows } from '../lib/supabasePagination.js';
import { planPoolRetirements } from '../lib/aiPoolRetirement.js';
import { inflightReleaseByTeam } from '../lib/aiTeamRaceObligations.js';
import { retireAiTeam } from '../lib/aiTeamRetirement.js';

// #4959: owner-facing times are Europe/Copenhagen, never UTC (CALENDAR_RULES).
const RELEASE_TIME_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Copenhagen', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hour12: false,
});
export function formatReleaseTime(iso) {
  const at = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(at)) return null;
  return RELEASE_TIME_FORMAT.format(new Date(at)).replace(', ', ' ');
}

export async function planRetirements({ supabase, now = new Date() }) {
  const [pools, teams] = await Promise.all([
    fetchAllRows(() => supabase.from('league_divisions').select('id, tier, pool_index, label').order('id')),
    fetchAllRows(() => supabase.from('teams').select('id, is_ai, is_bank, league_division_id').order('id')),
  ]);
  const result = [];
  for (const pool of pools) {
    const plan = await planPoolRetirements(supabase, pool.id, now);
    const inPool = teams.filter(t => t.league_division_id === pool.id && !t.is_bank);
    const candidates = plan.filter(c => !c.reason).map(c => ({
      id: c.team_id, name: c.team_name, pending_removal_at: c.pending_since,
      riders_retired: c.riders_count, transfer_offers_preserved: c.offers_preserved,
      transfer_offers_deleted: 0, future_entries_removed: c.future_entries_removed,
    }));
    result.push({ pool_id: pool.id, label: pool.label, tier: pool.tier, teams_now: inPool.length,
      ai_now: inPool.filter(t => t.is_ai).length, to_retire: candidates.length,
      teams_after: inPool.length - candidates.length, candidates,
      blocked: plan.filter(c => c.reason).map(c => ({ id: c.team_id, name: c.team_name, reason: c.reason })),
    });
  }
  // #4959: a race-blocked team is only readable with the date the block lifts -
  // otherwise "waiting" and "stuck forever" print identically. Read-only, and one
  // batched lookup for every blocked team in every pool.
  const raceBlocked = result.flatMap(p => p.blocked).filter(b => b.reason === 'inflight_entries');
  if (raceBlocked.length) {
    const release = await inflightReleaseByTeam(supabase, [...new Set(raceBlocked.map(b => b.id))]);
    for (const blocked of raceBlocked) {
      const found = release.get(blocked.id);
      blocked.inflight_races = found?.raceIds.length ?? 0;
      blocked.last_race_ends_at = found?.unscheduledRaceIds.length ? null : (found?.lastStageAt ?? null);
    }
  }
  return { generated_at: now.toISOString(), pools: result,
    total_candidates: result.reduce((n, p) => n + p.candidates.length, 0),
    total_blocked: result.reduce((n, p) => n + p.blocked.length, 0),
  };
}

export async function applyOneRetirement({ supabase, plan, teamId, ownerGo, now = new Date() }) {
  if (!ownerGo || !teamId) throw new Error('Apply requires owner go and a team ID from the live dry-run');
  const matches = plan.pools.flatMap(p => p.candidates).filter(c => c.id === teamId);
  if (matches.length !== 1) throw new Error('Approved team is no longer an unblocked excess candidate; run a new dry-run');
  const result = await retireAiTeam(supabase, teamId, { now });
  if (!result.retired) throw new Error(`Team was not retired: ${result.reason}. Run a new dry-run`);
  return { ...result, team: matches[0] };
}

// #4959: the release estimate is the last SCHEDULED stage of the races the team is
// still in. A stalled or rescheduled stage moves it, so it is printed as an estimate.
export function blockedSuffix(blocked) {
  if (blocked.reason !== 'inflight_entries') return '';
  const races = blocked.inflight_races ?? 0;
  const at = formatReleaseTime(blocked.last_race_ends_at);
  if (!at) return `; last in-flight race ends: unknown (${races} race(s) in flight)`;
  return `; last in-flight race ends ${at} CPH (${races} race(s) in flight, final scheduled stage)`;
}

function printHuman(plan) {
  console.log(`#4753 DRY-RUN (read-only) — ${plan.generated_at}`);
  for (const p of plan.pools) {
    if (!p.candidates.length && !p.blocked.length) continue;
    console.log(`${p.label} (pool ${p.pool_id}): ${p.teams_now} → ${p.teams_after} teams`);
    for (const c of p.candidates) console.log(`  ${c.name} (${c.id}): ${c.riders_retired} riders retired; ${c.transfer_offers_preserved} offers preserved; 0 offers deleted; ${c.future_entries_removed} future entries removed`);
    for (const c of p.blocked) console.log(`  WAIT ${c.name} (${c.id}): ${c.reason}${blockedSuffix(c)}`);
  }
  console.log(`${plan.total_candidates} candidates; ${plan.total_blocked} waiting. No writes performed.`);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const ownerGo = args.includes('--owner-go');
  const teamId = args.find(arg => arg.startsWith('--team='))?.slice(7);
  try {
    if (apply && (!ownerGo || !teamId)) throw new Error('--apply requires --owner-go and --team=<dry-run-id>');
    dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });
    const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) throw new Error('Missing Supabase configuration');
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
    const plan = await planRetirements({ supabase });
    if (apply) {
      const result = await applyOneRetirement({ supabase, plan, teamId, ownerGo });
      console.log(`Retired ${result.team.name} (${teamId}); ${result.ridersRetired} riders retired. Stop and run read-only verification.`);
    } else if (args.includes('--json')) console.log(JSON.stringify(plan, null, 2));
    else printHuman(plan);
    process.exitCode = !apply && plan.total_candidates > 0 ? 1 : 0;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}
