// Talentspejder Fase 3 (#2244) — orkestrerer scout_assignments-modning.
//
// #3997 (ejer-ord 20/8, "ret mekanikken, ikke oplysningen"): missioner og
// målrettede opgaver har nu to UAFHÆNGIGE modnings-stier, hver med sin egen
// idempotens-mekanik:
//   · target  — lazyCompleteDueTargetAssignments (scoutTargetMaturation.js),
//               kaldes her SWEEP-BREDT (uden teamId — alle hold) som backstop
//               for hold der aldrig åbner Scouting-centralen. Kl.22-gate +
//               team-dags-mutex (scout_sweep_runs) er UÆNDRET — targets
//               modner allerede minut-præcist via den lazy on-view-sti
//               (scoutAssignmentService.getScoutState, ~30 min), så denne
//               sti er ren backstop, ikke hovedstien.
//   · mission — completeDueMissionAssignments (scoutMissionMaturation.js).
//               INGEN dags-gate: kørt på HVERT cron-tick (5 min, cron.js —
//               langt hyppigere end den time-krævede kadence). FØR modnede
//               missioner udelukkende via kl.22-sweepen + en team-dags-mutex,
//               så en "1-dags" mission sendt kl. 09 reelt tog 23-46 timer.
//               Nu: modenhed = created_at + dage×24t (elapsed real tid), og
//               idempotens er PR ASSIGNMENT (claim-first UPDATE), ikke en
//               delt hold-dags-mutex — se scoutMissionMaturation.js.
import { copenhagenHour, copenhagenDateString } from "./copenhagenTime.js";
import { completeTargetAssignment } from "./scoutTargetMaturation.js";
import { completeDueMissionAssignments, defaultLoadCandidates } from "./scoutMissionMaturation.js";
import { notifyScoutReportReady } from "./notificationService.js"; // #2945

// Bagudkompatibelt re-export — defaultLoadCandidates boede her før #3997,
// flyttet til scoutMissionMaturation.js (mission-modningens eget modul).
export { defaultLoadCandidates };

// #3997: gælder KUN target-backstoppet nedenfor. Missioner har ingen dags-gate.
export const SWEEP_FROM_HOUR = 22;

export function shouldSweepNow(now = new Date()) {
  return copenhagenHour(now) >= SWEEP_FROM_HOUR;
}

/**
 * Target-backstop: modner alle 'target'-scout_assignments med ready_on <=
 * dagens Copenhagen-dato. UÆNDRET adfærd ift. før #3997 (samme kl.22-gate,
 * team-niveau mutex via scout_sweep_runs-INSERT, completeTargetAssignment) —
 * blot filtreret til kind='target' alene, siden missioner nu har sin egen sti.
 *
 * @returns {Promise<{swept: number, failed?: number}>}
 */
async function runTargetBackstopSweep({ supabase, now, notify }) {
  const tickDate = copenhagenDateString(now);

  const { data: matured, error } = await supabase
    .from("scout_assignments")
    .select("*")
    .eq("status", "active")
    .eq("kind", "target")
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
      console.error(`  ❌ scout-sweep (target-backstop) reservation fejlede for hold ${teamId}:`, reserveError.message);
      continue;
    }

    for (const assignment of assignments) {
      try {
        await completeTargetAssignment({ supabase, assignment, notify });
        swept += 1;
      } catch (err) {
        // best-effort pr. assignment: fejlen tælles i `failed`, som runScoutSweepCron
        // capturer AGGREGERET pr. tick (cron.js) — én Sentry-issue frem for pr. rytter.
        failed += 1;
        console.error(`  ❌ scout-sweep (target-backstop) fejlede for assignment ${assignment.id}:`, err.message);
      }
    }
  }

  return failed > 0 ? { swept, failed } : { swept };
}

/**
 * Kør scout-modning: missioner (ingen dags-gate, #3997) + target-backstop
 * (kl.22-gate, uændret). Kaldt på hvert cron-tick (5 min, cron.js).
 *
 * @returns {Promise<{swept: number, failed?: number}>}
 */
export async function runScoutSweep({
  supabase,
  now = new Date(),
  loadCandidates = defaultLoadCandidates,
  getScout, // videresendt til completeDueMissionAssignments — dens EGEN default bruges hvis udeladt
  notify = notifyScoutReportReady, // #2945, injicérbar for test
} = {}) {
  const missionResult = await completeDueMissionAssignments({ supabase, now, loadCandidates, getScout, notify });

  let targetSwept = 0;
  let targetFailed = 0;
  if (shouldSweepNow(now)) {
    const targetResult = await runTargetBackstopSweep({ supabase, now, notify });
    targetSwept = targetResult.swept;
    targetFailed = targetResult.failed ?? 0;
  }

  const swept = missionResult.completed + targetSwept;
  const failed = (missionResult.failed ?? 0) + targetFailed;
  return failed > 0 ? { swept, failed } : { swept };
}
