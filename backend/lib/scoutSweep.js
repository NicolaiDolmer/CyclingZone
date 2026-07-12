// Talentspejder Fase 3 (#2244) — daglig sweep: modner scout_assignments.
// Mirror af trainingSweep.js: Copenhagen-hour-gate + INSERT-som-mutex
// (scout_sweep_runs, UNIQUE(team_id, tick_date)) → idempotent, per-team
// try/catch isolerer én fejlende assignment fra resten.
//
// Pr. modnet assignment (ready_on <= tick_date, status='active'):
//   target  → indsætter scout_actions-rækker op til target_level (bevarer
//             eksisterende level=COUNT-derivation fra scouting.js), status→completed.
//   mission → kører mission-shortlist-generatoren (scoutMission.js), indsætter
//             ÉN gratis niveau-1-rapport på topfundet, status→completed.

import { copenhagenHour, copenhagenDateString } from "./copenhagenTime.js";
import { generateShortlist } from "./scoutMission.js";
import { getScoutState } from "./scoutAssignmentService.js";

export const SWEEP_FROM_HOUR = 22;

export function shouldSweepNow(now = new Date()) {
  return copenhagenHour(now) >= SWEEP_FROM_HOUR;
}

// Standard kandidat-loader for missioner: alle ikke-pensionerede ryttere med
// kendt potentiale, mappet til scoutMission's forventede rider-form.
async function defaultLoadCandidates(supabase) {
  const { data, error } = await supabase
    .from("riders")
    .select("id, potentiale, birthdate, nationality_code, is_retired, team:team_id(league_division_id)")
    .eq("is_retired", false)
    .not("potentiale", "is", null);
  if (error) throw new Error(`scoutSweep: candidate riders load failed: ${error.message}`);
  const currentYear = new Date().getFullYear();
  return (data ?? []).map((r) => ({
    id: r.id,
    potentiale: r.potentiale,
    divisionId: r.team?.league_division_id ?? null,
    country: r.nationality_code ?? null,
    age: r.birthdate ? currentYear - new Date(r.birthdate).getFullYear() : null,
    isNmEligible: true,
  }));
}

async function defaultGetScout(supabase, teamId) {
  const { scout } = await getScoutState(teamId, supabase);
  return scout;
}

async function completeTargetAssignment({ supabase, assignment }) {
  const { data: existing, error } = await supabase
    .from("scout_actions")
    .select("rider_id")
    .eq("team_id", assignment.team_id)
    .eq("rider_id", assignment.rider_id);
  if (error) throw new Error(`scout_actions load: ${error.message}`);
  const currentLevel = Math.min((existing ?? []).length, 3);
  const needed = Math.max(0, (assignment.target_level ?? 0) - currentLevel);

  for (let i = 0; i < needed; i++) {
    const { error: insErr } = await supabase
      .from("scout_actions")
      .insert({ team_id: assignment.team_id, rider_id: assignment.rider_id, season_id: assignment.season_id ?? null });
    if (insErr) throw new Error(`scout_actions insert: ${insErr.message}`);
  }

  const { error: updErr } = await supabase
    .from("scout_assignments")
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
      result: { level: assignment.target_level },
    })
    .eq("id", assignment.id);
  if (updErr) throw new Error(`scout_assignments update: ${updErr.message}`);
}

async function completeMissionAssignment({ supabase, assignment, loadCandidates, getScout, now }) {
  const [candidates, scout] = await Promise.all([
    loadCandidates(supabase),
    getScout(supabase, assignment.team_id),
  ]);
  const { shortlist, topRiderId } = generateShortlist({
    candidates,
    criteria: assignment.mission_criteria,
    scout,
    teamId: assignment.team_id,
    missionId: assignment.id,
  });

  if (topRiderId) {
    const { error: insErr } = await supabase
      .from("scout_actions")
      .insert({ team_id: assignment.team_id, rider_id: topRiderId, season_id: assignment.season_id ?? null });
    if (insErr) throw new Error(`scout_actions insert (mission top-find): ${insErr.message}`);
  }

  const { error: updErr } = await supabase
    .from("scout_assignments")
    .update({
      status: "completed",
      completed_at: now.toISOString(),
      result: { shortlist, top_rider_id: topRiderId },
    })
    .eq("id", assignment.id);
  if (updErr) throw new Error(`scout_assignments update: ${updErr.message}`);
}

/**
 * Kør daglig scout-sweep: modner alle scout_assignments hvis ready_on <=
 * dagens Copenhagen-dato. Team-niveau mutex (scout_sweep_runs INSERT, 23505
 * = allerede swept i dag) sikrer at en genkørt cron-tick er harmløs.
 *
 * @returns {Promise<{swept: number, failed?: number, skipped?: string}>}
 */
export async function runScoutSweep({
  supabase,
  now = new Date(),
  loadCandidates = defaultLoadCandidates,
  getScout = defaultGetScout,
} = {}) {
  if (!shouldSweepNow(now)) {
    return { swept: 0, skipped: "before_window" };
  }

  const tickDate = copenhagenDateString(now);

  const { data: matured, error } = await supabase
    .from("scout_assignments")
    .select("*")
    .eq("status", "active")
    .lte("ready_on", tickDate);
  if (error) throw new Error(`scout_assignments: ${error.message}`);
  if (!matured) throw new Error("scout_assignments query returned null (unexpected)");

  if (matured.length === 0) return { swept: 0 };

  const byTeam = new Map();
  for (const assignment of matured) {
    if (!byTeam.has(assignment.team_id)) byTeam.set(assignment.team_id, []);
    byTeam.get(assignment.team_id).push(assignment);
  }

  let swept = 0;
  let failed = 0;

  for (const [teamId, assignments] of byTeam) {
    // Reservation-first mutex (mirror dailyTrainingEngine): 23505 = allerede
    // swept for dette hold i dag → spring HELE holdet over (idempotent).
    const { error: reserveError } = await supabase
      .from("scout_sweep_runs")
      .insert({ team_id: teamId, tick_date: tickDate });
    if (reserveError) {
      if (reserveError.code === "23505") continue;
      failed += 1;
      console.error(`  ❌ scout-sweep reservation fejlede for hold ${teamId}:`, reserveError.message);
      continue;
    }

    for (const assignment of assignments) {
      try {
        if (assignment.kind === "target") {
          await completeTargetAssignment({ supabase, assignment });
        } else if (assignment.kind === "mission") {
          await completeMissionAssignment({ supabase, assignment, loadCandidates, getScout, now });
        }
        swept += 1;
      } catch (err) {
        // best-effort pr. assignment: fejlen tælles i `failed`, som runScoutSweepCron
        // capturer AGGREGERET pr. tick (cron.js) — én Sentry-issue frem for pr. rytter.
        failed += 1;
        console.error(`  ❌ scout-sweep fejlede for assignment ${assignment.id}:`, err.message);
      }
    }
  }

  return failed > 0 ? { swept, failed } : { swept };
}
