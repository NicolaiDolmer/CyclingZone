// #5631: tynd klient til ungdomsstillingen (GET /api/rankings/youth/standings).
//
// Endpointet bygges parallelt af spor Y7 backend (#5647, tabellen
// youth_season_standings). Kontrakten klienten forventer, med vilje tolerant
// over for små navneforskelle, så siden ikke knækker hvis backend'en vælger et
// andet feltnavn for holdnavnet eller puljens etiket:
//
//   GET /api/rankings/youth/standings?squad=u23|junior[&pool=<league_division_id>][&season_id=<uuid>]
//   200 { data: [{ team_id, team_name | teams.name, league_division_id,
//                  pool_index?, pool_label?, rank_in_pool, total_points,
//                  wins, podiums, races }] }
//   409 = kontakten youth_squad_pages er slukket (som /api/youth-squads)
//   404 = endpointet er ikke deployet endnu (staggered deploy)
//
// Klienten regner ALDRIG en placering ud selv: rank_in_pool kommer fra
// serveren. Den grupperer kun rækkerne pr. pulje og sorterer dem til visning.
//
// Ren .ts uden React- og Vite-import, så node --test kan loade den. Den
// bundne instans (auth-headere + apiFetch) ligger i
// components/squad/youthStandingsApi.ts.

export type YouthStandingsSquad = "u23" | "junior";

export interface YouthStandingRow {
  teamId: string;
  teamName: string | null;
  poolId: number | null;
  poolIndex: number | null;
  poolLabel: string | null;
  rank: number | null;
  points: number;
  wins: number;
  podiums: number;
  races: number;
}

export interface YouthStandingsPool {
  /** league_division_id; null = hold uden ungdomsgruppe (serverens egen partition). */
  id: number | null;
  index: number | null;
  label: string | null;
  rows: YouthStandingRow[];
}

export type YouthStandingsResult =
  | { status: "ok"; pools: YouthStandingsPool[] }
  | { status: "disabled" }
  | { status: "unavailable" }
  | { status: "error"; error: Error };

export interface YouthRequestResult {
  ok: boolean;
  status: number;
  data: unknown;
}

type Raw = Record<string, unknown>;

function num(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function nested(row: Raw, key: string): Raw | null {
  const value = row[key];
  if (Array.isArray(value)) return (value[0] as Raw) ?? null;
  return value && typeof value === "object" ? (value as Raw) : null;
}

function normalizeRow(raw: unknown): YouthStandingRow | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Raw;
  const teamId = str(row.team_id);
  if (!teamId) return null;
  const team = nested(row, "teams") ?? nested(row, "team");
  const pool = nested(row, "league_divisions") ?? nested(row, "pool");
  return {
    teamId,
    teamName: str(row.team_name) ?? str(team?.name),
    poolId: num(row.league_division_id) ?? num(row.pool_id) ?? num(pool?.id),
    poolIndex: num(row.pool_index) ?? num(pool?.pool_index),
    poolLabel: str(row.pool_label) ?? str(pool?.label),
    rank: num(row.rank_in_pool) ?? num(row.rank),
    points: num(row.total_points) ?? num(row.points) ?? 0,
    wins: num(row.wins) ?? 0,
    podiums: num(row.podiums) ?? 0,
    races: num(row.races) ?? num(row.races_completed) ?? 0,
  };
}

function compareRows(a: YouthStandingRow, b: YouthStandingRow): number {
  // Serverens placering vinder; rækker uden placering til sidst, efter point.
  if (a.rank != null && b.rank != null && a.rank !== b.rank) return a.rank - b.rank;
  if (a.rank != null && b.rank == null) return -1;
  if (a.rank == null && b.rank != null) return 1;
  if (a.points !== b.points) return b.points - a.points;
  return a.teamId.localeCompare(b.teamId);
}

function comparePools(a: YouthStandingsPool, b: YouthStandingsPool): number {
  // Hold uden gruppe står sidst; ellers gruppe-rækkefølgen (pool_index, så id).
  if (a.id == null && b.id != null) return 1;
  if (a.id != null && b.id == null) return -1;
  const ai = a.index ?? Number.MAX_SAFE_INTEGER;
  const bi = b.index ?? Number.MAX_SAFE_INTEGER;
  if (ai !== bi) return ai - bi;
  return (a.id ?? 0) - (b.id ?? 0);
}

/**
 * Serverens svar → puljer med sorterede rækker. `null` = svaret har ikke den
 * forventede form (kontraktfejl, ikke "ingen data").
 */
export function normalizeYouthStandings(payload: unknown): YouthStandingsPool[] | null {
  const data = Array.isArray(payload)
    ? payload
    : (payload as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return null;

  const byPool = new Map<string, YouthStandingsPool>();
  for (const raw of data) {
    const row = normalizeRow(raw);
    if (!row) continue;
    const key = row.poolId == null ? "none" : String(row.poolId);
    let pool = byPool.get(key);
    if (!pool) {
      pool = { id: row.poolId, index: row.poolIndex, label: row.poolLabel, rows: [] };
      byPool.set(key, pool);
    }
    if (pool.index == null && row.poolIndex != null) pool.index = row.poolIndex;
    if (pool.label == null && row.poolLabel != null) pool.label = row.poolLabel;
    pool.rows.push(row);
  }
  const pools = [...byPool.values()];
  for (const pool of pools) pool.rows.sort(compareRows);
  return pools.sort(comparePools);
}

/** Puljen holdet står i, eller null hvis holdet ikke er i nogen gruppe. */
export function poolForTeam(pools: YouthStandingsPool[], teamId: string | null | undefined): YouthStandingsPool | null {
  if (!teamId) return null;
  return pools.find((p) => p.id != null && p.rows.some((r) => r.teamId === teamId)) ?? null;
}

/** true når mindst ét hold i puljerne har kørt et løb. Før det vises ingen tabel (P11). */
export function hasYouthResults(pools: YouthStandingsPool[]): boolean {
  return pools.some((p) => p.rows.some((r) => r.races > 0 || r.points > 0));
}

/** Gruppe-bogstav ud fra pool_index: 0 → A, 8 → I. Ukendt → null. */
export function groupLetter(index: number | null | undefined): string | null {
  if (index == null || !Number.isInteger(index) || index < 0 || index > 25) return null;
  return String.fromCharCode(65 + index);
}

export function createYouthRankingsClient({ baseUrl, headers, request, reportError = () => {} }: {
  baseUrl: string;
  headers: () => Promise<Record<string, string> | null>;
  request: (url: string, init: { headers: Record<string, string> }) => Promise<YouthRequestResult>;
  reportError?: (error: Error, context: { path: string; status?: number }) => void;
}) {
  const path = "/api/rankings/youth/standings";

  async function getYouthStandings({ squad, pool, seasonId }: {
    squad: YouthStandingsSquad;
    pool?: number | null;
    seasonId?: string | null;
  }): Promise<YouthStandingsResult> {
    try {
      const auth = await headers();
      if (!auth) return { status: "error", error: new Error("Not signed in") };
      const query = new URLSearchParams({ squad });
      if (pool != null) query.set("pool", String(pool));
      if (seasonId) query.set("season_id", seasonId);
      const res = await request(`${baseUrl}${path}?${query.toString()}`, { headers: auth });
      if (res.status === 409) return { status: "disabled" };
      if (res.status === 404) return { status: "unavailable" };
      if (!res.ok) {
        const error = Object.assign(new Error(`Youth standings request failed (${res.status})`), { status: res.status });
        if (res.status !== 401) reportError(error, { path, status: res.status });
        return { status: "error", error };
      }
      const pools = normalizeYouthStandings(res.data);
      if (!pools) {
        const error = new Error("Invalid youth standings response");
        reportError(error, { path, status: res.status });
        return { status: "error", error };
      }
      return { status: "ok", pools };
    } catch (error) {
      return { status: "error", error: error instanceof Error ? error : new Error("Youth standings request failed") };
    }
  }

  return { getYouthStandings };
}
