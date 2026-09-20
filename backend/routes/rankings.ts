import { Router } from "express";
import type { Request, RequestHandler } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { fetchAllRows } from "../lib/supabasePagination.js";
import { toSupabaseError, isLockTimeoutError } from "../lib/supabaseErrorNormalize.js";
import { readHonours } from "./rankingHonours.ts";

// #5452: matviews genopfriskes via en PLAIN (eksklusiv) REFRESH (database/2026-07-27
// -3013-refresh-matviews-concurrently.sql) — en læser der ankommer i det vindue
// afbrydes af lock_timeout/statement_timeout (8s, service_role-rollen). Fejlen er
// altid en fuldt rullet-tilbage READ, så ÉN retry efter en kort pause er sikkert
// og dækker vinduet (typisk << 1s). De paginerede ruter (global/riders-lister,
// standings, race-points, honours) går allerede gennem fetchAllRows→withSupabaseRetry
// og er derfor allerede dækket — denne wrapper dækker de tre enkeltkald der IKKE
// paginerer (global?team_id, riders?top=5, race-count) og som derfor stod uden
// retry (Sentry CYCLINGZONE-65, første forekomst af klassen udenfor #3013/#4866).
// Retry KUN lock-timeout-klassen (isLockTimeoutError) — alt andet (fx 42501
// permission denied) gives videre uændret efter første forsøg.
const LOCK_TIMEOUT_RETRY_DELAY_MS = 250;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function attachStatus(error: unknown, status: number | undefined) {
  if (error && typeof error === "object") Object.assign(error, { status });
  return error;
}

async function withLockTimeoutRetry<T extends { error: unknown; status?: number }>(
  run: () => PromiseLike<T>,
): Promise<T> {
  const result = await run();
  if (result.error && isLockTimeoutError(attachStatus(result.error, result.status))) {
    await sleep(LOCK_TIMEOUT_RETRY_DELAY_MS);
    return await run();
  }
  return result;
}

const uuid = z.uuid();
// seasons.id er ikke RFC-UUID (00000000-0000-0000-0000-00000000000N, version-nibble 0), saa z.uuid() afviser
// ALLE saeson-kald med 400 i prod (CYCLINGZONE-5V/5W, 13/9). GUID-form (8-4-4-4-12 hex) er nok her.
const seasonId = z.guid();
const ids = z.string().max(3699).transform(value => value.split(","))
  .pipe(z.array(uuid).min(1).max(100));
const globalQuery = z.strictObject({ team_id: uuid.optional() });
const riderQuery = z.strictObject({ season_id: seasonId, rider_ids: ids.optional(), top: z.literal("5").optional() })
  .refine(query => !(query.rider_ids && query.top));
const seasonQuery = z.strictObject({ season_id: seasonId });
const raceQuery = z.strictObject({ season_id: seasonId.optional(), race_ids: ids.optional() })
  .refine(query => Boolean(query.season_id) !== Boolean(query.race_ids));
const countQuery = z.strictObject({ team_id: uuid });

// No client-controlled projections, ordering, table names or raw PostgREST filters.
// These are public result aggregates; any signed-in manager can compare teams.
const GLOBAL_COLUMNS = "team_id,name,division,is_ai,banked_points,season_points,global_points,active_recent,is_rookie,global_rank";
const RIDER_COLUMNS = "season_id,rider_id,points,prize_earned,stage_wins,gc_wins,classic_wins,pts_wins,mtn_wins,young_wins,yellow_days,green_days,polka_days,white_days,top3,top10";
const STANDINGS_COLUMNS = "season_id,team_id,comp_wins,comp_podiums,podiums,prize_earned";

export function createRankingsRouter({ supabase, requireAuth, reportError, viewerClient }: {
  supabase: SupabaseClient;
  requireAuth: RequestHandler;
  reportError: (error: unknown) => void;
  viewerClient: (authorization: string) => SupabaseClient;
}) {
  const router = Router();
  router.use(requireAuth);

  function get<T extends z.ZodType>(path: string, schema: T, read: (query: z.output<T>, req: Request) => Promise<unknown>) {
    router.get(path, async (req, res) => {
      const parsed = schema.safeParse(req.query);
      if (!parsed.success) { res.status(400).json({ error: "Invalid ranking query" }); return; }
      try {
        res.set("Cache-Control", "private, no-store").json(await read(parsed.data, req));
      } catch (error) {
        reportError(error);
        res.status(500).json({ error: "Unable to load rankings" });
      }
    });
  }

  get("/global", globalQuery, async ({ team_id }) => {
    if (team_id) {
      const { data, error } = await withLockTimeoutRetry(() =>
        supabase.from("global_rank_mv").select(GLOBAL_COLUMNS).eq("team_id", team_id).maybeSingle());
      if (error) throw error;
      return { data: data ? [data] : [] };
    }
    const data = await fetchAllRows(() => supabase.from("global_rank_mv").select(GLOBAL_COLUMNS)
      .order("global_rank", { ascending: true, nullsFirst: false }).order("team_id"));
    return { data };
  });

  get("/riders", riderQuery, async ({ season_id, rider_ids, top }) => {
    if (top) {
      const { data, error } = await withLockTimeoutRetry(() =>
        supabase.from("rider_rankings_mv")
          .select("rider_id,points,stage_wins,gc_wins").eq("season_id", season_id)
          .order("points", { ascending: false }).order("rider_id").limit(5));
      if (error) throw error;
      return { data: data || [] };
    }
    const data = await fetchAllRows(() => {
      let query = supabase.from("rider_rankings_mv").select(RIDER_COLUMNS).eq("season_id", season_id).order("rider_id");
      if (rider_ids) query = query.in("rider_id", rider_ids);
      return query;
    });
    return { data };
  });

  get("/standings", seasonQuery, async ({ season_id }) => ({
    data: await fetchAllRows(() => supabase.from("team_standings_ext_mv").select(STANDINGS_COLUMNS)
      .eq("season_id", season_id).order("team_id")),
  }));

  get("/honours", seasonQuery, async ({ season_id }, req) => ({
    data: await readHonours(supabase, viewerClient(req.headers.authorization || ""), season_id),
  }));

  get("/race-points", raceQuery, async ({ season_id, race_ids }) => ({
    data: await fetchAllRows(() => {
      let query = supabase.from("team_race_points_mv").select("team_id,race_id,race_points")
        .order("team_id").order("race_id");
      if (season_id) query = query.eq("season_id", season_id);
      if (race_ids) query = query.in("race_id", race_ids);
      return query;
    }),
  }));

  get("/race-count", countQuery, async ({ team_id }) => {
    // #5224: et HEAD-svar ({ head: true }) har INGEN body per HTTP-spec, heller
    // ikke ved fejl — PostgREST/postgrest-js kan derfor kun give os `{ message:
    // "" }` uden code/details/hint (CYCLINGZONE-5X, tom Sentry-titel). Den
    // faktiske HTTP-status ER stadig tilgængelig og er dermed det eneste
    // brugbare diagnose-signal her — wrap fejlen med rute + status som kontekst
    // (toSupabaseError bevarer code/details/hint når PostgREST rent faktisk
    // sendte dem, fx for et 4xx-svar med body).
    const { count, error, status } = await withLockTimeoutRetry(() =>
      supabase.from("team_race_points_mv")
        .select("race_id", { count: "exact", head: true }).eq("team_id", team_id));
    if (error) {
      // toSupabaseError falder tilbage til "Supabase error" når body'en (og
      // dermed message/code/details/hint) var tom — HTTP-statussen er dét vi
      // rent faktisk har at diagnosticere på i det tilfælde.
      const wrapped = toSupabaseError(error);
      wrapped.message = `race-count (HTTP ${status}): ${wrapped.message}`;
      throw wrapped;
    }
    if (count == null) throw new Error(`race-count (HTTP ${status}): missing ranking count`);
    return { count };
  });
  return router;
}
