/**
 * Cycling Zone — Discord division-role sync (#2153 Fase 5).
 * =========================================================
 * Spillet er source of truth for hvilken division/gruppe en spiller er i
 * (teams.league_division_id). Denne modul holder spillerens Discord-gruppe-rolle
 * i sync med spillet — så den ALDRIG bliver stale ved sæson-skift / op-nedrykning,
 * uden manuelle reaction-roller.
 *
 * Kræver at Cycling Zone-botten har `Manage Roles` + at bot-rollen ligger over
 * de 15 division-roller i hierarkiet (opfyldt: botten oprettede rollerne).
 * En spiller får kun rolle hvis hen er MEDLEM af serveren + har linket discord_id.
 */

const API = "https://discord.com/api/v10";

/** Cycling Zone (ny server) guild-id. */
export const DIVISION_GUILD_ID = "1504615050831466669";

/** league_division_id → Discord role-id (oprettet #2153 Fase 5). */
export const DIVISION_ROLE_MAP = {
  1: "1522721606126800947",
  2: "1522721609444622537",
  3: "1522721612665851904",
  4: "1522721615425572885",
  5: "1522721618877612042",
  6: "1522721622530719855",
  7: "1522721625835831449",
  8: "1522721634782281868",
  9: "1522721638427394089",
  10: "1522721641237577810",
  11: "1522721644999872564",
  12: "1522721648690856007",
  13: "1522721652071469167",
  14: "1522721655456006374",
  15: "1522721658635419830",
};

const ALL_DIVISION_ROLE_IDS = new Set(Object.values(DIVISION_ROLE_MAP));

/**
 * REN: givet medlemmets nuværende rolle-ids + mål-division, beregn hvilke
 * division-roller der skal fjernes og tilføjes. Rører ALDRIG ikke-division-roller.
 *
 * @param {{ memberRoleIds?: string[], targetLeagueDivisionId?: number|null }} o
 * @returns {{ toAdd: string|null, toRemove: string[] }}
 */
export function computeDivisionRoleUpdate({ memberRoleIds = [], targetLeagueDivisionId } = {}) {
  const targetRole = DIVISION_ROLE_MAP[targetLeagueDivisionId] || null;
  const current = new Set(memberRoleIds);
  const toRemove = [...current].filter((id) => ALL_DIVISION_ROLE_IDS.has(id) && id !== targetRole);
  const toAdd = targetRole && !current.has(targetRole) ? targetRole : null;
  return { toAdd, toRemove };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function dapi(path, { method = "GET", botToken, fetchImpl = fetch, okStatuses = [] } = {}) {
  const res = await fetchImpl(`${API}${path}`, {
    method,
    headers: { Authorization: `Bot ${botToken}`, "Content-Type": "application/json" },
  });
  if (res.status === 429) {
    const body = await res.json().catch(() => ({}));
    await sleep(Math.ceil((body.retry_after || 1) * 1000) + 300);
    return dapi(path, { method, botToken, fetchImpl, okStatuses });
  }
  return res;
}

/**
 * Sync én spillers division-rolle mod målet. Springer over hvis spilleren ikke
 * er medlem af serveren (404). Best-effort — kaster ikke ved delvise fejl.
 */
export async function syncMemberDivisionRole({
  guildId = DIVISION_GUILD_ID,
  discordId,
  targetLeagueDivisionId,
  botToken,
  fetchImpl = fetch,
}) {
  if (!discordId || !botToken) return { skipped: "missing-input" };

  const memberRes = await dapi(`/guilds/${guildId}/members/${discordId}`, { botToken, fetchImpl });
  if (memberRes.status === 404) return { skipped: "not-a-member" };
  if (!memberRes.ok) return { skipped: `member-fetch-${memberRes.status}` };
  const member = await memberRes.json();

  const { toAdd, toRemove } = computeDivisionRoleUpdate({
    memberRoleIds: member.roles || [],
    targetLeagueDivisionId,
  });

  const removed = [];
  for (const roleId of toRemove) {
    const r = await dapi(`/guilds/${guildId}/members/${discordId}/roles/${roleId}`, { method: "DELETE", botToken, fetchImpl });
    if (r.ok || r.status === 204) removed.push(roleId);
    await sleep(300);
  }
  let added = null;
  if (toAdd) {
    const r = await dapi(`/guilds/${guildId}/members/${discordId}/roles/${toAdd}`, { method: "PUT", botToken, fetchImpl });
    if (r.ok || r.status === 204) added = toAdd;
    await sleep(300);
  }
  return { added, removed };
}

/**
 * Reconcile ALLE linkede spilleres division-roller mod spillets tilstand.
 * Henter (discord_id, league_division_id) for ægte hold, springer AI/test over.
 * Idempotent + selv-helende: kalder hver dag/efter sæson-skift → roller matcher altid.
 */
export async function syncAllDivisionRoles({ supabase, botToken, guildId = DIVISION_GUILD_ID, fetchImpl = fetch }) {
  if (!botToken) return { synced: 0, skipped: 0, changed: 0, reason: "no-bot-token" };

  const { data: teams, error } = await supabase
    .from("teams")
    .select("league_division_id, user_id, users:user_id(discord_id)")
    .eq("is_ai", false)
    .eq("is_test_account", false)
    .not("league_division_id", "is", null);
  if (error) throw new Error(`syncAllDivisionRoles select: ${error.message}`);

  let synced = 0, skipped = 0, changed = 0;
  for (const team of teams || []) {
    const discordId = team.users?.discord_id;
    if (!discordId) { skipped++; continue; }
    const res = await syncMemberDivisionRole({
      guildId, discordId, targetLeagueDivisionId: team.league_division_id, botToken, fetchImpl,
    });
    if (res.skipped) { skipped++; continue; }
    synced++;
    if (res.added || res.removed?.length) changed++;
  }
  return { synced, skipped, changed };
}
