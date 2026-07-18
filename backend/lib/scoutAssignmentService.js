// Talentspejder Fase 3 (#2244) — scout_assignments-service: start/cancel + spejder-opslag.
// Mønster: facilityService.js (I/O-lag, ren logik/validering ligger i scoutEngine.js).
// Al balance-mutation går via economyEngine.debitTeam (ledger + idempotency).
//
// Scout-opslag: aktiv team_staff-row med role='scouting' + dens
// staff_derived_abilities (roleSkills: evaluation/reach). Ingen hyret spejder →
// DEFAULT_SCOUT (overall 40) — systemet skal virke for alle hold fra dag 1.
import { DEFAULT_SCOUT, SCOUT_JOB_CONFIG, scoutCapacity, travelCostFor, readyDateFor, canStartAssignment } from "./scoutEngine.js";
import { debitTeam } from "./economyEngine.js";
import { hydrateCompletedVisibility } from "./scoutReportVisibility.js";
import { lazyCompleteDueTargetAssignments } from "./scoutTargetMaturation.js";

const COMPLETED_LIMIT = 20;

async function loadTeamBalance(teamId, supabaseClient) {
  const { data, error } = await supabaseClient
    .from("teams")
    .select("balance")
    .eq("id", teamId)
    .single();
  if (error) throw new Error(`scoutAssignmentService: could not load team balance for ${teamId}: ${error.message}`);
  return data.balance ?? 0;
}

// Aktivt hyret talentspejder (staff-rollen fra #2216) eller DEFAULT_SCOUT.
async function loadScout(teamId, supabaseClient) {
  const { data: staffRow, error: staffError } = await supabaseClient
    .from("team_staff")
    .select("id, name, role, tier, salary, status")
    .eq("team_id", teamId)
    .eq("role", "scouting")
    .eq("status", "active")
    .maybeSingle();
  if (staffError) throw new Error(`scoutAssignmentService: could not load scouting staff for ${teamId}: ${staffError.message}`);
  if (!staffRow) return { ...DEFAULT_SCOUT };

  const { data: abilities, error: abilityError } = await supabaseClient
    .from("staff_derived_abilities")
    .select("overall, role_skills")
    .eq("staff_id", staffRow.id)
    .maybeSingle();
  if (abilityError) throw new Error(`scoutAssignmentService: could not load staff abilities for ${staffRow.id}: ${abilityError.message}`);
  if (!abilities) return { ...DEFAULT_SCOUT };

  return {
    id: staffRow.id,
    name: staffRow.name,
    overall: abilities.overall,
    roleSkills: abilities.role_skills ?? DEFAULT_SCOUT.roleSkills,
    isDefault: false,
  };
}

async function loadActiveAssignments(teamId, supabaseClient) {
  const { data, error } = await supabaseClient
    .from("scout_assignments")
    .select("*")
    .eq("team_id", teamId)
    .eq("status", "active");
  if (error) throw new Error(`scoutAssignmentService: could not load active assignments for ${teamId}: ${error.message}`);
  return data ?? [];
}

async function loadCompletedAssignments(teamId, supabaseClient) {
  const { data, error } = await supabaseClient
    .from("scout_assignments")
    .select("*")
    .eq("team_id", teamId)
    .eq("status", "completed")
    .order("completed_at", { ascending: false })
    .limit(COMPLETED_LIMIT);
  if (error) throw new Error(`scoutAssignmentService: could not load completed assignments for ${teamId}: ${error.message}`);
  return data ?? [];
}

// Holdets nuværende scout-niveau (0..3) på én rytter, udledt af scout_actions
// (samme ledger #1543/scouting.js bruger — niveau bevares på tværs af job-modellen).
async function loadCurrentLevel(teamId, riderId, supabaseClient) {
  const { data, error } = await supabaseClient
    .from("scout_actions")
    .select("rider_id")
    .eq("team_id", teamId)
    .eq("rider_id", riderId);
  if (error) throw new Error(`scoutAssignmentService: could not load scout_actions for ${teamId}/${riderId}: ${error.message}`);
  return Math.min((data ?? []).length, 3);
}

// Priser/varigheder som frontend skal vise — SSOT er SCOUT_JOB_CONFIG i scoutEngine.js.
// #2644: targetDaysPerLevel afløst af targetEtaMinutes (flad ~30 min, uanset niveau —
// se scoutEngine.js' kommentar for den ærlige nattelige-sweep-forbeholdelse).
const JOB_CONFIG_RESPONSE = Object.freeze({
  targetEtaMinutes: SCOUT_JOB_CONFIG.target.etaMinutes,
  targetCostPerLevel: SCOUT_JOB_CONFIG.target.costPerLevel,
  missionDays: SCOUT_JOB_CONFIG.mission.days,
  missionCost: SCOUT_JOB_CONFIG.mission.cost,
});

// {scout, active, completed, capacity, jobConfig} — al frontend-tilstand for Scouting-central.
// #2644 beslutning 2/3: completed-rapporter hydreres med en server-side synligheds-
// guard (scoutReportVisibility.js) FØR de forlader serveren — en rapport må aldrig
// afsløre en rytter der lige nu er skjult/utilgængelig, uanset hvad den var på
// genererings-tidspunktet (#2623-rod-årsagen).
export async function getScoutState(teamId, supabaseClient) {
  // #2644 (ejer-beslutning 18/7): due enkelt-rytter-undersøgelser (~30 min)
  // modnes ved visning — nattesweepet er kun backstop for hold der aldrig
  // åbner siden. Skal ske FØR active/completed loades, så en netop-due
  // undersøgelse dukker op som færdig rapport i samme svar.
  await lazyCompleteDueTargetAssignments({ supabase: supabaseClient, teamId });
  const [scout, active, completedRaw] = await Promise.all([
    loadScout(teamId, supabaseClient),
    loadActiveAssignments(teamId, supabaseClient),
    loadCompletedAssignments(teamId, supabaseClient),
  ]);
  const completed = await hydrateCompletedVisibility(supabaseClient, completedRaw);
  return { scout, active, completed, capacity: scoutCapacity(scout), jobConfig: JOB_CONFIG_RESPONSE };
}

export async function startTargetAssignment({ teamId, riderId, seasonId }, supabaseClient, now = new Date()) {
  const [scout, active, balance, fromLevel] = await Promise.all([
    loadScout(teamId, supabaseClient),
    loadActiveAssignments(teamId, supabaseClient),
    loadTeamBalance(teamId, supabaseClient),
    loadCurrentLevel(teamId, riderId, supabaseClient),
  ]);
  if (fromLevel >= 3) return { ok: false, error: "max_level" };

  const toLevel = fromLevel + 1;
  const cost = travelCostFor("target", { fromLevel, toLevel });
  const guard = canStartAssignment({ activeCount: active.length, scout, balance, cost });
  if (!guard.ok) return { ok: false, error: guard.reason };

  const startedOn = now.toISOString().slice(0, 10);
  const readyOn = readyDateFor("target", now, { fromLevel, toLevel }).toISOString().slice(0, 10);

  const { data: inserted, error: insertError } = await supabaseClient
    .from("scout_assignments")
    .insert({
      team_id: teamId,
      staff_id: scout.isDefault ? null : scout.id,
      kind: "target",
      rider_id: riderId,
      target_level: toLevel,
      travel_cost: cost,
      started_on: startedOn,
      ready_on: readyOn,
      season_id: seasonId ?? null,
    })
    .select("id")
    .single();
  if (insertError) throw new Error(`scoutAssignmentService: target insert failed for ${teamId}/${riderId}: ${insertError.message}`);

  const debit = await debitTeam(teamId, cost, "scout_travel", null, seasonId, supabaseClient, {
    idempotent: true,
    metadata: { code: "tx.scoutTravel", params: { kind: "target", riderId, targetLevel: toLevel } },
    audit: {
      sourcePath: "scoutAssignmentService.startTargetAssignment",
      idempotencyKey: `scout_travel:${teamId}:${inserted.id}`,
    },
  });

  return {
    ok: true,
    assignment: {
      id: inserted.id, kind: "target", riderId, targetLevel: toLevel,
      travelCost: cost, startedOn, readyOn,
    },
    ...(debit.skipped ? { skipped: true } : {}),
  };
}

// #2644 del 2 (ejer-go 18/7): missioner target'er nu ENTEN kontraktfrie ELLER
// ryttere på andre managers hold — spillerens valg pr. mission, gemt på selve
// mission_criteria (jsonb, ingen migration nødvendig). Navngivet targetPool for
// IKKE at kollidere med criteria.scope (division/country/u23/nm — det EKSISTERENDE
// geografiske/aldersmæssige missions-filter, en helt anden akse). Default
// "free_agents" (bagudkompatibel: gamle assignments uden feltet læses som
// free_agents af scoutSweep.js' completeMissionAssignment).
export const VALID_MISSION_TARGET_POOLS = Object.freeze(["free_agents", "other_teams"]);

export async function startMission({ teamId, criteria, seasonId }, supabaseClient, now = new Date()) {
  const targetPool = criteria?.targetPool ?? "free_agents";
  if (!VALID_MISSION_TARGET_POOLS.includes(targetPool)) {
    return { ok: false, error: "invalid_target_pool" };
  }
  const normalizedCriteria = { ...criteria, targetPool };

  const [scout, active, balance] = await Promise.all([
    loadScout(teamId, supabaseClient),
    loadActiveAssignments(teamId, supabaseClient),
    loadTeamBalance(teamId, supabaseClient),
  ]);

  const cost = travelCostFor("mission");
  const guard = canStartAssignment({ activeCount: active.length, scout, balance, cost });
  if (!guard.ok) return { ok: false, error: guard.reason };

  const startedOn = now.toISOString().slice(0, 10);
  const readyOn = readyDateFor("mission", now).toISOString().slice(0, 10);

  const { data: inserted, error: insertError } = await supabaseClient
    .from("scout_assignments")
    .insert({
      team_id: teamId,
      staff_id: scout.isDefault ? null : scout.id,
      kind: "mission",
      mission_criteria: normalizedCriteria,
      travel_cost: cost,
      started_on: startedOn,
      ready_on: readyOn,
      season_id: seasonId ?? null,
    })
    .select("id")
    .single();
  if (insertError) throw new Error(`scoutAssignmentService: mission insert failed for ${teamId}: ${insertError.message}`);

  const debit = await debitTeam(teamId, cost, "scout_travel", null, seasonId, supabaseClient, {
    idempotent: true,
    metadata: { code: "tx.scoutTravel", params: { kind: "mission", criteria: normalizedCriteria } },
    audit: {
      sourcePath: "scoutAssignmentService.startMission",
      idempotencyKey: `scout_travel:${teamId}:${inserted.id}`,
    },
  });

  return {
    ok: true,
    assignment: { id: inserted.id, kind: "mission", criteria: normalizedCriteria, travelCost: cost, startedOn, readyOn },
    ...(debit.skipped ? { skipped: true } : {}),
  };
}

// Ingen refusion v1 (spec-beslutning) — annullering er en ren status-flip.
export async function cancelAssignment({ teamId, assignmentId }, supabaseClient) {
  const { data: assignment, error } = await supabaseClient
    .from("scout_assignments")
    .select("id, status")
    .eq("id", assignmentId)
    .eq("team_id", teamId)
    .maybeSingle();
  if (error) throw new Error(`scoutAssignmentService: could not load assignment ${assignmentId}: ${error.message}`);
  if (!assignment || assignment.status !== "active") return { ok: false, error: "not_found" };

  const { error: updateError } = await supabaseClient
    .from("scout_assignments")
    .update({ status: "cancelled" })
    .eq("id", assignmentId);
  if (updateError) throw new Error(`scoutAssignmentService: cancel failed for ${assignmentId}: ${updateError.message}`);

  return { ok: true };
}
