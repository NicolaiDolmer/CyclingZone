// Talentspejder Fase 3 (#2244) — scout_assignments-service: start/cancel + spejder-opslag.
// Mønster: facilityService.js (I/O-lag, ren logik/validering ligger i scoutEngine.js).
// Al balance-mutation går via economyEngine.debitTeam (ledger + idempotency).
//
// Scout-opslag: aktiv team_staff-row med role='scouting' + dens
// staff_derived_abilities (roleSkills: evaluation/reach). Ingen hyret spejder →
// DEFAULT_SCOUT (overall 40) — systemet skal virke for alle hold fra dag 1.
import { DEFAULT_SCOUT, SCOUT_JOB_CONFIG, scoutCapacity, travelCostFor, readyDateFor, targetReadyAt, canStartAssignment } from "./scoutEngine.js";
import { debitTeam } from "./economyEngine.js";
import { FINANCE_REASON } from "./economyConstants.js";
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
// Eksporteret (#3213): api.js' display-endpoints bruger samme opslag så
// spejder-ratingen driver bånd-gulvet i buildScoutEstimate/buildTypeCeilingBands.
//
// #3489 (flere spejdere samtidigt — vertikal skive): holdet kan nu have op til
// MAX_STAFF_SLOTS_PER_ROLE (2) aktive scouting-staff. Motoren her vælger den
// STÆRKESTE (højeste overall) af dem som "den handlende spejder" for kapacitet/
// præcision — samme "bedste-af-flere"-valg som trainingStaffContext.js og
// facilityRoutesHandlers.getClubFacilitiesHandler. Ved 0 eller 1 aktiv er
// adfærden UÆNDRET. Ægte PR-KAPACITETSUDVIDELSE (2 scouts = 2 SAMTIDIGE
// missioner/undersøgelser, hver spejder ruter sine egne opgaver) kræver at
// scoutEngine.canStartAssignment/scoutCapacity og scout_assignments.staff_id
// bliver PR-scout-specifikke i stedet for pr.-hold — bevidst UDENFOR denne
// slice, se opfølgnings-punkt i PR-beskrivelsen.
export async function loadScout(teamId, supabaseClient) {
  const { data: staffRows, error: staffError } = await supabaseClient
    .from("team_staff")
    .select("id, name, role, tier, salary, status, created_at")
    .eq("team_id", teamId)
    .eq("role", "scouting")
    .eq("status", "active");
  if (staffError) throw new Error(`scoutAssignmentService: could not load scouting staff for ${teamId}: ${staffError.message}`);
  if (!staffRows?.length) return { ...DEFAULT_SCOUT };

  const staffIds = staffRows.map((r) => r.id);
  const { data: abilityRows, error: abilityError } = await supabaseClient
    .from("staff_derived_abilities")
    .select("staff_id, overall, role_skills")
    .in("staff_id", staffIds);
  if (abilityError) throw new Error(`scoutAssignmentService: could not load staff abilities for ${teamId}: ${abilityError.message}`);
  const abilityByStaffId = new Map((abilityRows ?? []).map((a) => [a.staff_id, a]));

  let best = null;
  for (const staffRow of staffRows) {
    const abilities = abilityByStaffId.get(staffRow.id);
    if (!abilities) continue; // #2216 A4 self-heal-scope: ingen ability-row → udelades, ikke crash.
    if (!best || abilities.overall > best.abilities.overall) best = { staffRow, abilities };
  }
  if (!best) return { ...DEFAULT_SCOUT };

  return {
    id: best.staffRow.id,
    name: best.staffRow.name,
    tier: best.staffRow.tier,
    // #3334: hvornår DENNE scout blev ansat — bruges af scouting-report-provenance
    // (frontend "assessed by X, since <dato>") så rapport-omskrivning ved scout-
    // skift ikke opleves som en uforklaret rytter-forringelse.
    hiredAt: best.staffRow.created_at ?? null,
    overall: best.abilities.overall,
    roleSkills: best.abilities.role_skills ?? DEFAULT_SCOUT.roleSkills,
    isDefault: false,
  };
}

// #3548: aktive målrettede undersøgelser får `ready_at` (ISO UTC) med ud.
// Serveren ejer reglen (created_at + etaMinutes, se targetReadyAt) — frontend
// skal kun tælle ned til tidspunktet, ikke udlede det. Missioner beholder
// `ready_on` alene: de modnes af den natlige 22-sweep (scoutSweep.js) og er
// derfor dags-granulære, ikke minut-granulære.
function withTargetReadyAt(rows) {
  return (rows ?? []).map((row) => {
    if (row?.kind !== "target") return row;
    const readyAt = targetReadyAt(row.created_at);
    return readyAt ? { ...row, ready_at: readyAt.toISOString() } : row;
  });
}

async function loadActiveAssignments(teamId, supabaseClient) {
  const { data, error } = await supabaseClient
    .from("scout_assignments")
    .select("*")
    .eq("team_id", teamId)
    .eq("status", "active");
  if (error) throw new Error(`scoutAssignmentService: could not load active assignments for ${teamId}: ${error.message}`);
  return withTargetReadyAt(data ?? []);
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

// Historik pr. spejder (#3203, Discord-løfte 27/7): hvilke ryttere har DENNE
// spejder (staffId) selv afsluttet en målrettet undersøgelse på — kun
// 'target'-opgaver (individuel rytter-efterretning, niveau 1→3). Mission-
// shortlists (nyopdagede ryttere fra en scene-mission) er en anden feature og
// vises allerede holds-bredt i Scouting-central (ShortlistFeed, #2644) — de
// hører ikke til "ryttere DENNE spejder har scoutet" i samme 1:1-forstand.
//
// Knyttet til staff_id, IKKE til om spejderen stadig er ansat (#2649: en
// fyret spejders tidligere rapporter forbliver hans egne, synlige via hans
// profil hvis den stadig kan tilgås). team_id+staff_id filtreres SAMMEN, så
// et fremmed holds staff-id blot giver en tom liste — ingen data-læk mulig.
//
// Samme synligheds-guard som getScoutState (#2644 beslutning 1/4): en rytter
// der er blevet skjult/utilgængelig siden rapporten blev lavet, må ikke lække
// via historikken.
const SCOUT_HISTORY_LIMIT = 50;

export async function loadScoutHistory({ teamId, staffId }, supabaseClient) {
  if (!staffId) return [];
  const { data, error } = await supabaseClient
    .from("scout_assignments")
    .select("id, rider_id, target_level, completed_at")
    .eq("team_id", teamId)
    .eq("staff_id", staffId)
    .eq("kind", "target")
    .eq("status", "completed")
    .order("completed_at", { ascending: false })
    .limit(SCOUT_HISTORY_LIMIT);
  if (error) throw new Error(`scoutAssignmentService: could not load scout history for ${teamId}/${staffId}: ${error.message}`);
  const rows = (data ?? []).map((r) => ({ ...r, kind: "target" }));
  return hydrateCompletedVisibility(supabaseClient, rows);
}

// #2721 — det REELLE gap efter #3369's "TeamScoutHistory"-sektion (audit
// 2026-08-15 flyttede issuet tilbage til claude:todo): frontend-sektionen
// genbrugte `completed` fra getScoutState, som er BEGRÆNSET til 20 rækker OG
// deler den grænse med mission-fund (loadCompletedAssignments, COMPLETED_LIMIT
// ovenfor). Målrettede undersøgelser modner på ~30 min (#2644) — en aktiv
// spiller kan sagtens nå at skubbe sine egne ældre undersøgelser ud af top-20
// i løbet af én session, præcis den "jeg har spejdet nogle ryttere, men kan
// ikke finde dem igen"-oplevelse issuet blev oprettet for. Pr.-scout-historikken
// (#3203, loadScoutHistory ovenfor) undgår allerede fælden ved at bruge sin
// EGEN target-only forespørgsel med et 50-loft; denne funktion giver
// hold-historikken (på tværs af scouts) samme afkobling og samme loft, i
// stedet for at dele completed's blandede 20-cap.
const TEAM_HISTORY_LIMIT = 50;

export async function loadTeamScoutHistory(teamId, supabaseClient) {
  const { data, error } = await supabaseClient
    .from("scout_assignments")
    .select("id, rider_id, target_level, completed_at")
    .eq("team_id", teamId)
    .eq("kind", "target")
    .eq("status", "completed")
    .order("completed_at", { ascending: false })
    .limit(TEAM_HISTORY_LIMIT);
  if (error) throw new Error(`scoutAssignmentService: could not load team scout history for ${teamId}: ${error.message}`);
  const rows = (data ?? []).map((r) => ({ ...r, kind: "target" }));
  return hydrateCompletedVisibility(supabaseClient, rows);
}

// {scout, active, completed, teamHistory, capacity, jobConfig} — al frontend-tilstand for Scouting-central.
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
  const [scout, active, completedRaw, teamHistory] = await Promise.all([
    loadScout(teamId, supabaseClient),
    loadActiveAssignments(teamId, supabaseClient),
    loadCompletedAssignments(teamId, supabaseClient),
    loadTeamScoutHistory(teamId, supabaseClient),
  ]);
  const completed = await hydrateCompletedVisibility(supabaseClient, completedRaw);
  return { scout, active, completed, teamHistory, capacity: scoutCapacity(scout), jobConfig: JOB_CONFIG_RESPONSE };
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
    // #3548: created_at læses tilbage fra DB'en (ikke fra `now`), så det
    // klar-tidspunkt klienten viser er udledt af PRÆCIS den timestamp
    // lazyCompleteDueTargetAssignments senere måler deadline'en mod.
    .select("id, created_at")
    .single();
  if (insertError) throw new Error(`scoutAssignmentService: target insert failed for ${teamId}/${riderId}: ${insertError.message}`);

  const debit = await debitTeam(teamId, cost, "scout_travel", null, seasonId, supabaseClient, {
    idempotent: true,
    metadata: { code: "tx.scoutTravel", params: { kind: "target", riderId, targetLevel: toLevel } },
    audit: {
      sourcePath: "scoutAssignmentService.startTargetAssignment",
      // #3198-fund-8: se facilityService.purchaseFacilityUpgrade for baggrund.
      reasonCode: FINANCE_REASON.SCOUT_TRAVEL,
      idempotencyKey: `scout_travel:${teamId}:${inserted.id}`,
    },
  });

  const readyAt = targetReadyAt(inserted.created_at ?? now);

  return {
    ok: true,
    assignment: {
      id: inserted.id, kind: "target", riderId, targetLevel: toLevel,
      travelCost: cost, startedOn, readyOn,
      // #3548: nedtællingen kan starte med det samme efter POST, uden at vente
      // på næste GET /scouting/me.
      readyAt: readyAt ? readyAt.toISOString() : null,
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
      // #3198-fund-8: se facilityService.purchaseFacilityUpgrade for baggrund.
      reasonCode: FINANCE_REASON.SCOUT_TRAVEL,
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
