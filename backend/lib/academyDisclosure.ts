// Own academy riders share the academy's training-based knowledge on every surface.
import { rosterPrognosis } from "./academyIntake2View.ts";
import type { RosterPrognosis } from "./academyIntake2View.ts";
import { learningSpeed, loadPullSignedRiderIds, loadTrainingDaysOnTeam } from "./academyProspectKnowledge.ts";
import { loadTrainingStaffContext } from "./trainingStaffContext.js";

import { readFlagStage, evaluateFlagStage } from "./featureStage.js";
import { ACADEMY_INTAKE_PULL_FLAG_KEY } from "./academyIntakePullFlag.js";

// An unavailable rollout flag must never grant extra knowledge.
export async function isAcademyKnowledgeEnabled(supabase: any): Promise<boolean> {
  const stage = await readFlagStage(supabase, ACADEMY_INTAKE_PULL_FLAG_KEY);
  if (![true, false, "on", "off", "beta"].includes(stage)) {
    throw new Error("academy knowledge flag unavailable");
  }
  return evaluateFlagStage(stage);
}

type Row = Record<string, any>;
export function academyEstimate(prognosis: RosterPrognosis) {
  return { academyPrognosis: prognosis };
}

export async function loadAcademyPrognoses(supabase: any, { enabled, teamId, riders, abilitiesByRider, seasonNumber, scout }: {
  enabled: boolean; teamId: string; riders: Row[]; abilitiesByRider: Map<string, Row>;
  seasonNumber: number; scout: unknown;
}): Promise<Map<string, RosterPrognosis>> {
  const ownAcademy = enabled ? riders.filter((r) => r.team_id === teamId && r.is_academy === true) : [];
  if (!ownAcademy.length) return new Map();
  // #7195: kun Optag 2.0-ryttere; ryttere holdet havde før, får den normale scoutrapport.
  const pulled = await loadPullSignedRiderIds(supabase, { teamId, riderIds: ownAcademy.map((r) => r.id) });
  const academy = ownAcademy.filter((r) => pulled.has(r.id));
  if (!academy.length) return new Map();
  const [staff, days] = await Promise.all([
    loadTrainingStaffContext(supabase, teamId),
    loadTrainingDaysOnTeam(supabase, { teamId, riderIds: academy.map((r) => r.id) }),
  ]);
  const speed = learningSpeed(staff);
  return new Map(academy.map((rider) => [rider.id, rosterPrognosis({
    rider: rider as any, abilities: abilitiesByRider.get(rider.id), potRow: rider as any,
    daysOnTeam: days.get(rider.id) ?? 0, speed, seasonNumber, teamId, scout,
  })]));
}
