// #2644 (ejer-beslutning 18/7): enkelt-rytter-undersøgelsen skal svare på ~30
// minutter — ikke først ved 22-sweepet. Delt modul for target-modning, så både
// nattesweepet (scoutSweep.js, backstop for hold der aldrig åbner siden) og
// lazy-finaliseringen ved visning (scoutAssignmentService.getScoutState) bruger
// præcis samme insert-logik. Eget modul frem for scoutSweep.js: sweepen
// importerer allerede fra scoutAssignmentService, så den modsatte retning ville
// være et cirkulært import.
import { SCOUT_JOB_CONFIG } from "./scoutEngine.js";
import { notifyScoutReportReady } from "./notificationService.js"; // #2945

// scout_actions op til assignmentens target_level (bevarer den eksisterende
// level=COUNT-derivation fra scouting.js). Genberegner behovet fra DB hver gang
// — et re-kald efter delvis indsættelse indsætter kun det manglende.
async function insertTargetActions({ supabase, assignment }) {
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
}

// Sweep-stien (uændret adfærd ift. før #2644-flytningen hertil): actions først,
// derefter status→completed. Dobbeltkørsel afskærmes af sweepens team-dags-mutex
// (scout_sweep_runs), ikke her.
//
// #2945: notify() kaldes EFTER status→completed er bekræftet — notifyScoutReportReady
// isolerer selv sine fejl (fanger, logger, Sentry, kaster aldrig), så en
// notifikationsfejl aldrig kan vælte selve fuldførelsen. `notify` injicérbar for test.
export async function completeTargetAssignment({ supabase, assignment, notify = notifyScoutReportReady }) {
  await insertTargetActions({ supabase, assignment });

  const { error: updErr } = await supabase
    .from("scout_assignments")
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
      result: { level: assignment.target_level },
    })
    .eq("id", assignment.id);
  if (updErr) throw new Error(`scout_assignments update: ${updErr.message}`);

  await notify({ supabase, assignment: { ...assignment, status: "completed" } });
}

// Lazy-stien (kaldes ved hver visning af Scouting-centralen): claim FØRST via
// status-conditional update — ved samtidige kald (dashboard + central åbnes
// parallelt, dobbelt Railway-boot) vinder præcis én, og kun vinderen indsætter
// scout_actions. Taberen ser 0 claimede rækker og rører intet. Nattesweepet
// selekterer status='active' og springer derfor allerede-claimede over.
export async function lazyCompleteDueTargetAssignments({
  supabase,
  teamId,
  now = new Date(),
  etaMinutes = SCOUT_JOB_CONFIG.target.etaMinutes,
  notify = notifyScoutReportReady, // #2945, injicérbar for test
}) {
  const dueBefore = new Date(now.getTime() - etaMinutes * 60_000).toISOString();
  const { data: due, error } = await supabase
    .from("scout_assignments")
    .select("*")
    .eq("team_id", teamId)
    .eq("status", "active")
    .eq("kind", "target")
    .lte("created_at", dueBefore);
  if (error) throw new Error(`scout_assignments (lazy target): ${error.message}`);

  let completed = 0;
  for (const assignment of due ?? []) {
    const { data: claimed, error: claimErr } = await supabase
      .from("scout_assignments")
      .update({
        status: "completed",
        completed_at: now.toISOString(),
        result: { level: assignment.target_level },
      })
      .eq("id", assignment.id)
      .eq("status", "active")
      .select("id");
    if (claimErr) throw new Error(`scout_assignments claim: ${claimErr.message}`);
    if (!claimed || claimed.length === 0) continue;

    await insertTargetActions({ supabase, assignment });
    // #2945: dette er hovedstien (#2644 ~30 min) — kaldt inde i en GET-request,
    // så notify() må ALDRIG kaste (notifyScoutReportReady isolerer selv sine fejl).
    await notify({ supabase, assignment: { ...assignment, status: "completed" }, now });
    completed += 1;
  }
  return { completed };
}
