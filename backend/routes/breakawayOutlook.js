// #6912 B: GET /api/races/:raceId/breakaway-outlook — motorens udbrudschance for
// løbets næste etape. Al logik bor i lib/breakawayOutlook.js; ruten er auth, flag,
// opslag af løbet og fejlhåndtering. Svaret er kun brøken og årsagens art, aldrig
// rå andele, seeds eller flag-stadiet.
//
// #6912-opfølgning (hærdning før tænding), billigste afvisning først:
//  1. raceId skal være et UUID: ellers 400 uden nogen forespørgsel og uden rapport.
//  2. flaget for seeren.
//  3. løbet + relevans: aktiv sæson, en næste etape, og seerens hold er tilmeldt eller
//     kan tilmelde sig. Ellers { available:false, reason:"not_relevant" }.
//  4. motor v4 tændt og næste etapes profil har et udbrud (ikke ITT/TTT), FØR dry-run.
//  5. startfeltets fingeraftryk indgår i cache-nøglen; en fejl huskes i 5 min.
import express from "express";
import {
  computeBreakawayOutlook,
  getBreakawayOutlookCached,
  isBreakawayOutlookEnabled,
  isOutlookRelevantForViewer,
  isValidRaceId,
  loadEntriesFingerprint,
  loadNextStageProfileType,
  stageAllowsBreakaway,
} from "../lib/breakawayOutlook.js";
import { isRaceEngineV4Enabled } from "../lib/raceEngineFlag.js";
import { resolveRaceEngineV4, simulateStageByIndex } from "../lib/raceRunner.js";

const RACE_COLUMNS = "id, name, race_type, race_class, stages, stages_completed, status, season_id, league_division_id, scheduled_for, squad, engine_rules_revision";

export function createBreakawayOutlookRouter({
  supabase, requireAuth, isViewerBetaTester, readLimiter, reportError = () => {},
  isEnabled = isBreakawayOutlookEnabled,
  compute = computeBreakawayOutlook,
  getCached = getBreakawayOutlookCached,
  runStage = simulateStageByIndex,
  resolveEngine = resolveRaceEngineV4,
  checkV4Enabled = isRaceEngineV4Enabled,
  isRelevant = isOutlookRelevantForViewer,
  loadProfileType = loadNextStageProfileType,
  loadFingerprint = loadEntriesFingerprint,
}) {
  const router = express.Router();

  router.get("/races/:raceId/breakaway-outlook", requireAuth, readLimiter, async (req, res) => {
    if (!isValidRaceId(req.params.raceId)) return res.status(400).json({ available: false, reason: "invalid_race" });
    try {
      const isBetaTester = await isViewerBetaTester(req);
      if (!(await isEnabled(supabase, { isBetaTester }))) return res.json({ available: false, reason: "off" });
      const { data: race, error } = await supabase.from("races").select(RACE_COLUMNS).eq("id", req.params.raceId).maybeSingle();
      if (error) throw error;
      if (!race) return res.status(404).json({ error: "race_not_found" });
      if (!(await isRelevant({ supabase, race, team: req.team }))) return res.json({ available: false, reason: "not_relevant" });
      // Samme læsning som afviklingen (resolveRaceEngineV4 kalder checkV4Enabled(supabase)).
      if (!(await checkV4Enabled(supabase))) return res.json({ available: false, reason: "engine_off" });
      if (!stageAllowsBreakaway(await loadProfileType({ supabase, race }))) return res.json({ available: false, reason: "no_breakaway" });
      const entriesKey = await loadFingerprint({ supabase, raceId: race.id });
      const outlook = await getCached({
        race,
        entriesKey,
        compute: () => compute({
          race,
          resolveRaceEngineV4: resolveEngine,
          runDryStage: ({ stageIndex, resolveV4Engine }) => runStage({ supabase, race, stageIndex, dryRun: true, resolveV4Engine, checkV4Enabled }),
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
