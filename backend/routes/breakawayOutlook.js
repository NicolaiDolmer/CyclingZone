// #6912 B: GET /api/races/:raceId/breakaway-outlook — motorens udbrudschance for
// løbets næste etape. Al logik bor i lib/breakawayOutlook.js; ruten er auth, flag,
// opslag af løbet og fejlhåndtering. Svaret er kun brøken og årsagens art, aldrig
// rå andele, seeds eller flag-stadiet.
import express from "express";
import {
  computeBreakawayOutlook,
  getBreakawayOutlookCached,
  isBreakawayOutlookEnabled,
} from "../lib/breakawayOutlook.js";
import { resolveRaceEngineV4, simulateStageByIndex } from "../lib/raceRunner.js";

const RACE_COLUMNS = "id, name, race_type, race_class, stages, stages_completed, status, season_id, league_division_id, scheduled_for, squad, engine_rules_revision";

export function createBreakawayOutlookRouter({
  supabase, requireAuth, isViewerBetaTester, readLimiter, reportError = () => {},
  isEnabled = isBreakawayOutlookEnabled,
  compute = computeBreakawayOutlook,
  getCached = getBreakawayOutlookCached,
  runStage = simulateStageByIndex,
  resolveEngine = resolveRaceEngineV4,
}) {
  const router = express.Router();

  router.get("/races/:raceId/breakaway-outlook", requireAuth, readLimiter, async (req, res) => {
    try {
      const isBetaTester = await isViewerBetaTester(req);
      if (!(await isEnabled(supabase, { isBetaTester }))) return res.json({ available: false, reason: "off" });
      const { data: race, error } = await supabase.from("races").select(RACE_COLUMNS).eq("id", req.params.raceId).maybeSingle();
      if (error) throw error;
      if (!race) return res.status(404).json({ error: "race_not_found" });
      const outlook = await getCached({
        race,
        compute: () => compute({
          race,
          resolveRaceEngineV4: resolveEngine,
          runDryStage: ({ stageIndex, resolveV4Engine }) => runStage({ supabase, race, stageIndex, dryRun: true, resolveV4Engine }),
        }),
      });
      res.json(outlook);
    } catch (error) {
      reportError(error, { tags: { route: "/races/:raceId/breakaway-outlook" } });
      // best-effort: rapporteret ovenfor; en fejl skjuler chancen, den vælter ikke udtagelsen.
      res.json({ available: false, reason: "error" });
    }
  });

  return router;
}
