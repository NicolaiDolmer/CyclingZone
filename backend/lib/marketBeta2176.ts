// #2176: shared, fresh cohort and rollout decisions. SQL repeats authorization
// under its transaction locks; these reads are never the final money gate.
import type { SupabaseClient } from '@supabase/supabase-js';
import { evaluateFlagStage } from './featureStage.js';

export type MarketClient2176 = Pick<SupabaseClient, 'from' | 'rpc'>;
export type MarketActor2176 = { userId?: string | null; teamId?: string | null; isBetaTester?: boolean };
type Listing = { seller_team_id?: string | null; seller?: { id?: string | null } | null; auto_accept_price?: unknown };
type Offer = { seller?: { id?: string | null } | null; buyer?: { id?: string | null } | null; auto_accept_eligible?: boolean };
type OfferGroups<T> = { sent: T[]; received: T[]; archivedSent: T[]; archivedReceived: T[] };
const evaluateMarketStage2176 = (value: unknown) =>
  evaluateFlagStage(typeof value === 'string' || typeof value === 'boolean' ? value : null);
export type MarketSpendIssue2176 = { error: 'insufficient_available_balance'; available?: number; locked?: number };
export type MarketSwapPayment2176 = {
  payer_team_id: string;
  payee_team_id: string;
  amount: number;
  payer_payload: Record<string, unknown>;
  payee_payload: Record<string, unknown>;
  rider_restore: Record<string, unknown>;
};

export function readMarketSpendIssue2176(error: unknown): MarketSpendIssue2176 | null {
  if (error === null || typeof error !== 'object') return null;
  const row = error as Record<string, unknown>;
  if (row.code !== 'P0001' || typeof row.message !== 'string'
    || !/market_gate_6181:insufficient_available_balance(?:\s|$)/.test(row.message)) return null;
  const issue: MarketSpendIssue2176 = { error: 'insufficient_available_balance' };
  try {
    const raw = row.details ?? row.detail;
    const detail: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (detail !== null && typeof detail === 'object' && !Array.isArray(detail)) {
      const values = detail as Record<string, unknown>;
      for (const key of ['available', 'locked'] as const) {
        const value = Number(values[key]);
        if (Number.isSafeInteger(value) && value >= 0 && values[key] != null) issue[key] = value;
      }
    }
  } catch {
    // Malformed optional detail cannot invalidate the refusal or invent money.
    return issue;
  }
  return issue;
}

export async function readMarketFlag2176(client: MarketClient2176, key: string): Promise<unknown> {
  const { data, error } = await client.from('app_config').select('value').eq('key', key).maybeSingle();
  if (error) {
    // Preserve auto-accept's existing fail-closed error identity.
    if (key === 'auto_accept_enabled') throw error;
    throw new Error(`marketBeta2176: flag lookup failed for ${key}: ${error.message}`);
  }
  return data?.value ?? null;
}

export async function isUserBeta2176(client: MarketClient2176, userId?: string | null): Promise<boolean> {
  if (!userId) return false;
  const { data, error } = await client.from('users').select('role,is_beta_tester').eq('id', userId).maybeSingle();
  if (error) throw new Error(`marketBeta2176: user lookup failed: ${error.message}`);
  return data?.role === 'admin' || data?.is_beta_tester === true;
}

export async function betaTeamIds2176(client: MarketClient2176, teamIds: string[]): Promise<Set<string>> {
  const ids = [...new Set(teamIds.filter(Boolean))];
  const allowed = new Set<string>();
  // Bound each query below PostgREST's row cap; the caller may pass a whole page.
  for (let offset = 0; offset < ids.length; offset += 400) {
    const { data: teams, error: teamError } = await client.from('teams').select('id,user_id').in('id', ids.slice(offset, offset + 400));
    if (teamError) throw new Error(`marketBeta2176: team lookup failed: ${teamError.message}`);
    const owners = [...new Set((teams ?? []).map(row => row.user_id).filter((id): id is string => typeof id === 'string'))];
    if (!owners.length) continue;
    const { data: users, error: userError } = await client.from('users').select('id,role,is_beta_tester').in('id', owners);
    if (userError) throw new Error(`marketBeta2176: user lookup failed: ${userError.message}`);
    const betaOwners = new Set((users ?? []).filter(row => row.role === 'admin' || row.is_beta_tester === true).map(row => row.id));
    for (const team of teams ?? []) if (betaOwners.has(team.user_id)) allowed.add(team.id);
  }
  return allowed;
}

export async function isTeamBeta2176(client: MarketClient2176, teamId?: string | null): Promise<boolean> {
  return Boolean(teamId && (await betaTeamIds2176(client, [teamId])).has(teamId));
}

export async function isAutoAcceptActorEnabled2176(client: MarketClient2176, actor: MarketActor2176 = {}): Promise<boolean> {
  const value = await readMarketFlag2176(client, 'auto_accept_enabled');
  if (value !== 'beta') return evaluateMarketStage2176(value);
  const isBetaTester = typeof actor.isBetaTester === 'boolean' ? actor.isBetaTester
    : actor.teamId ? await isTeamBeta2176(client, actor.teamId) : await isUserBeta2176(client, actor.userId);
  return evaluateFlagStage(value, { isBetaTester });
}

export async function isAutoAcceptPairEnabled2176(client: MarketClient2176, {
  sellerTeamId, buyerTeamId,
}: { sellerTeamId?: string | null; buyerTeamId?: string | null }): Promise<boolean> {
  const value = await readMarketFlag2176(client, 'auto_accept_enabled');
  if (value !== 'beta') return evaluateMarketStage2176(value);
  if (!sellerTeamId || !buyerTeamId) return false;
  const teams = await betaTeamIds2176(client, [sellerTeamId, buyerTeamId]);
  return evaluateFlagStage(value, { isBetaTester: teams.has(sellerTeamId) && teams.has(buyerTeamId) });
}

export async function projectAutoAcceptListings2176<T extends Listing>(client: MarketClient2176, rows: T[], actor: MarketActor2176 = {}): Promise<T[]> {
  const value = await readMarketFlag2176(client, 'auto_accept_enabled');
  if (value !== 'beta' && evaluateMarketStage2176(value)) return rows;
  const viewerBeta = value === 'beta' && (typeof actor.isBetaTester === 'boolean' ? actor.isBetaTester
    : actor.userId ? await isUserBeta2176(client, actor.userId) : await isTeamBeta2176(client, actor.teamId));
  const sellerId = (row: Listing) => row.seller_team_id ?? row.seller?.id;
  const eligible = viewerBeta ? await betaTeamIds2176(client, rows.flatMap(row => sellerId(row) ? [sellerId(row)!] : [])) : new Set<string>();
  return rows.map(row => {
    const teamId = sellerId(row);
    if (teamId && eligible.has(teamId)) return row;
    const copy = { ...row };
    delete copy.auto_accept_price;
    return copy;
  });
}

export async function isMarketTransportEnabled2176(client: MarketClient2176): Promise<boolean> {
  const value = await readMarketFlag2176(client, 'market_commitment_6181');
  return value === 'beta' || value === 'on' || value === true;
}

export async function isMarketBetaMode2176(client: MarketClient2176): Promise<boolean> {
  const market = await readMarketFlag2176(client, 'market_commitment_6181');
  if (market === 'beta') return true;
  // Auto-accept beta also needs atomic payments when M3 is already global.
  if (market !== 'on' && market !== true) return false;
  return await readMarketFlag2176(client, 'auto_accept_enabled') === 'beta';
}

export async function marketProtectedTeamIds2176(client: MarketClient2176, teamIds: string[]): Promise<Set<string>> {
  const ids = [...new Set(teamIds.filter(Boolean))];
  const value = await readMarketFlag2176(client, 'market_commitment_6181');
  if (value === 'on' || value === true) return new Set(ids);
  const protectedIds = new Set<string>();
  if (value !== 'beta') return protectedIds;
  for (const teamId of ids) {
    const { data, error } = await client.rpc('market_scope_2176', { p_team_id: teamId, p_auction_id: null });
    if (error) throw new Error(`marketBeta2176: scope failed: ${error.message}`);
    if (typeof data !== 'boolean') throw new Error('marketBeta2176: invalid scope result');
    if (data) protectedIds.add(teamId);
  }
  return protectedIds;
}

export async function projectAutoAcceptOffers2176<T extends Offer>(client: MarketClient2176, groups: OfferGroups<T>, viewerTeamId: string): Promise<OfferGroups<T>> {
  if (await readMarketFlag2176(client, 'auto_accept_enabled') !== 'beta') return groups;
  const sent = [...groups.sent, ...groups.archivedSent];
  const received = [...groups.received, ...groups.archivedReceived];
  const peers = [...sent.map(row => row.seller?.id), ...received.map(row => row.buyer?.id)].filter((id): id is string => typeof id === 'string');
  if (!peers.length) return groups;
  const beta = await betaTeamIds2176(client, [viewerTeamId, ...peers]);
  const project = (rows: T[], side: 'seller' | 'buyer') => rows.map(row => ({ ...row,
    auto_accept_eligible: beta.has(viewerTeamId) && Boolean(row[side]?.id && beta.has(row[side]!.id!)),
  }));
  return { sent: project(groups.sent, 'seller'), archivedSent: project(groups.archivedSent, 'seller'),
    received: project(groups.received, 'buyer'), archivedReceived: project(groups.archivedReceived, 'buyer') };
}

export async function isMarketProtectionEnabled2176(client: MarketClient2176, {
  teamId, auctionId = null,
}: { teamId?: string | null; auctionId?: string | null }): Promise<boolean> {
  const value = await readMarketFlag2176(client, 'market_commitment_6181');
  if (value !== 'beta') return value === 'on' || value === true;
  if (!teamId) return false;
  const { data, error } = await client.rpc('market_scope_2176', { p_team_id: teamId, p_auction_id: auctionId });
  if (error) throw new Error(`marketBeta2176: scope failed: ${error.message}`);
  if (typeof data !== 'boolean') throw new Error('marketBeta2176: invalid scope result');
  return data;
}
