// Own academy riders share the academy's training-based knowledge on every surface.
import { rosterPrognosis } from "./academyIntake2View.ts";
import type { RosterPrognosis } from "./academyIntake2View.ts";
import { learningSpeed, loadTrainingDaysOnTeam } from "./academyProspectKnowledge.ts";
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

export async function loadAcademyPrognoses(supabase: any, { enabled, teamId, riders, abilitiesByRider, seasonNumber, scout, bestRole = false }: {
  enabled: boolean; teamId: string; riders: Row[]; abilitiesByRider: Map<string, Row>;
  seasonNumber: number; scout: unknown; bestRole?: boolean;
}): Promise<Map<string, RosterPrognosis>> {
  const academy = enabled ? riders.filter((r) => r.team_id === teamId && r.is_academy === true) : [];
  if (!academy.length) return new Map();
  const [staff, days] = await Promise.all([
    loadTrainingStaffContext(supabase, teamId),
    loadTrainingDaysOnTeam(supabase, { teamId, riderIds: academy.map((r) => r.id) }),
  ]);
  const speed = learningSpeed(staff);
  return new Map(academy.map((rider) => [rider.id, rosterPrognosis({
    rider: rider as any, abilities: abilitiesByRider.get(rider.id), potRow: rider as any,
    daysOnTeam: days.get(rider.id) ?? 0, speed, seasonNumber, teamId, scout, bestRole,
  })]));
}
