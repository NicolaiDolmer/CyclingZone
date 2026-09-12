type Row = Record<string, unknown>;
type Result<T> = { data: T | null; error: Error | null };

export function createRankingsClient({ baseUrl, headers, fetcher }: {
  baseUrl: string;
  headers: () => Promise<Record<string, string> | null>;
  fetcher: typeof fetch;
}) {
  async function request(path: string, query: Record<string, string>): Promise<unknown> {
    const auth = await headers();
    if (!auth) throw new Error("Not signed in");
    const search = new URLSearchParams(query).toString();
    const response = await fetcher(`${baseUrl}${path}${search ? `?${search}` : ""}`, { headers: auth });
    if (!response.ok) throw new Error(`Ranking request failed (${response.status})`);
    return response.json();
  }

  async function rows(path: string, query: Record<string, string> = {}): Promise<Result<Row[]>> {
    try {
      const body = await request(path, query) as { data?: unknown } | null;
      if (!body || !Array.isArray(body.data)) throw new Error("Invalid ranking response");
      return { data: body.data as Row[], error: null };
    } catch (error) {
      return { data: null, error: error instanceof Error ? error : new Error("Ranking request failed") };
    }
  }

  async function unwrap(result: Promise<Result<Row[]>>): Promise<Row[]> {
    const { data, error } = await result;
    if (error) throw error;
    return data || [];
  }

  return {
    fetchGlobalRanks: () => unwrap(rows("/api/rankings/global")),
    getGlobalRank: async (teamId: string): Promise<Result<Row>> => {
      const result = await rows("/api/rankings/global", { team_id: teamId });
      return { data: result.data?.[0] || null, error: result.error };
    },
    fetchRiderRankings: (seasonId: string) => unwrap(rows("/api/rankings/riders", { season_id: seasonId })),
    getRiderRankings: (seasonId: string, riderIds?: string[]) => rows("/api/rankings/riders", {
      season_id: seasonId, ...(riderIds ? { rider_ids: riderIds.join(",") } : {}),
    }),
    getTopRiderRankings: (seasonId: string) => rows("/api/rankings/riders", { season_id: seasonId, top: "5" }),
    fetchTeamStandings: (seasonId: string) => unwrap(rows("/api/rankings/standings", { season_id: seasonId })),
    fetchTeamRacePoints: (seasonId: string) => unwrap(rows("/api/rankings/race-points", { season_id: seasonId })),
    getRaceDayPoints: (raceIds: string[]) => rows("/api/rankings/race-points", { race_ids: raceIds.join(",") }),
    getRaceCount: async (teamId: string): Promise<{ count: number | null; error: Error | null }> => {
      try {
        const body = await request("/api/rankings/race-count", { team_id: teamId }) as { count?: unknown } | null;
        if (!body || typeof body.count !== "number" || !Number.isSafeInteger(body.count) || body.count < 0) {
          throw new Error("Invalid ranking count");
        }
        return { count: body.count, error: null };
      } catch (error) {
        return { count: null, error: error instanceof Error ? error : new Error("Ranking count failed") };
      }
    },
  };
}
