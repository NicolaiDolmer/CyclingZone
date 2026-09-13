import { Router } from "express";
import type { Request, RequestHandler } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { fetchAllRows } from "../lib/supabasePagination.js";
import { readHonours } from "./rankingHonours.ts";

const uuid = z.uuid();
const ids = z.string().max(3699).transform(value => value.split(","))
  .pipe(z.array(uuid).min(1).max(100));
const globalQuery = z.strictObject({ team_id: uuid.optional() });
const riderQuery = z.strictObject({ season_id: uuid, rider_ids: ids.optional(), top: z.literal("5").optional() })
  .refine(query => !(query.rider_ids && query.top));
const seasonQuery = z.strictObject({ season_id: uuid });
const raceQuery = z.strictObject({ season_id: uuid.optional(), race_ids: ids.optional() })
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
      const { data, error } = await supabase.from("global_rank_mv").select(GLOBAL_COLUMNS).eq("team_id", team_id).maybeSingle();
      if (error) throw error;
      return { data: data ? [data] : [] };
    }
    const data = await fetchAllRows(() => supabase.from("global_rank_mv").select(GLOBAL_COLUMNS)
      .order("global_rank", { ascending: true, nullsFirst: false }).order("team_id"));
    return { data };
  });

  get("/riders", riderQuery, async ({ season_id, rider_ids, top }) => {
    if (top) {
      const { data, error } = await supabase.from("rider_rankings_mv")
        .select("rider_id,points,stage_wins,gc_wins").eq("season_id", season_id)
        .order("points", { ascending: false }).order("rider_id").limit(5);
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
    const { count, error } = await supabase.from("team_race_points_mv")
      .select("race_id", { count: "exact", head: true }).eq("team_id", team_id);
    if (error) throw error;
    if (count == null) throw new Error("Missing ranking count");
    return { count };
  });
  return router;
}
