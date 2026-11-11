import { FINANCE_ACTOR_TYPE, FINANCE_REASON, FINANCE_RELATED_ENTITY } from './economyConstants.js';
import { isMarketBetaMode2176, readMarketSpendIssue2176 } from './marketBeta2176.ts';
import type { MarketClient2176, MarketSpendIssue2176 } from './marketBeta2176.ts';

export type ScoutAssignment2176 = {
  team_id: string; staff_id?: string | null; kind: 'target' | 'mission'; rider_id?: string;
  target_level?: number; mission_criteria?: unknown; travel_cost: number;
  started_on: string; ready_on: string; season_id?: string | null;
};
type ScoutCreated2176 = { id: string; created_at: string };
type ScoutResult2176 = { status: 'created'; assignment: ScoutCreated2176; debit: { skipped: boolean } }
  | { status: 'refused'; issue: MarketSpendIssue2176 } | null;

export async function createScoutAssignmentBeta2176(client: MarketClient2176, {
  assignment, sourcePath, metadata,
}: { assignment: ScoutAssignment2176; sourcePath: 'scoutAssignmentService.startMission' | 'scoutAssignmentService.startTargetAssignment'; metadata: Record<string, unknown> }): Promise<ScoutResult2176> {
  if (!(await isMarketBetaMode2176(client))) return null;
  // These are debitTeam's existing audit defaults. SQL supplies the canonical
  // key using the assignment UUID it creates in the same transaction.
  const payload = {
    type: 'scout_travel', amount: -assignment.travel_cost, description: null,
    season_id: assignment.season_id ?? null, actor_type: FINANCE_ACTOR_TYPE.CRON, actor_id: null,
    source_path: sourcePath, reason_code: FINANCE_REASON.SCOUT_TRAVEL,
    related_entity_type: FINANCE_RELATED_ENTITY.SEASON, related_entity_id: assignment.season_id ?? null,
    metadata,
  };
  const { data, error } = await client.rpc('market_scout_assignment_2176', {
    p_team_id: assignment.team_id, p_assignment: assignment, p_finance_payload: payload,
  });
  if (error) {
    const issue = readMarketSpendIssue2176(error);
    if (issue) return { status: 'refused', issue };
    throw error;
  }
  if (data?.status === 'legacy') return null;
  if (data?.status !== 'created' || typeof data.assignment?.id !== 'string' || typeof data.assignment?.created_at !== 'string') {
    throw new Error('market_scout_assignment_2176: invalid committed receipt');
  }
  return { status: 'created', assignment: data.assignment, debit: { skipped: data.skipped === true } };
}
