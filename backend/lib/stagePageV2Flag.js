// #6570: Etapeside 2.0 bag stadie-flaget `stage_page_v2` (off | beta | on,
// featureStage.js). Moenster kopieret fra trainingMobileTableFlag.js +
// firstRaceCardFlag.js.
//
// EJER 14/10: "beta foerst for feedback". Migrationen
// (database/2026-10-14-6570-stage-page-v2-flag.sql) opretter raekken med stadie
// "off"; ejeren flytter den til beta fra admin-fladen. Alle andre end
// beta-testere ser den nuvaerende loebsside uaendret, ogsaa i beta-stadiet.
//
// Beta-status laeses SERVER-SIDE (isViewerBetaTester i routes/api.js) og aldrig
// fra klienten. Svaret er en bar boolean, aldrig det raa stadie.
//
// Fail-safe: manglende/ukendt vaerdi eller fejl giver false, dvs. den gamle side.

import express from "express";
import { readFlagStage, evaluateFlagStage } from "./featureStage.js";

export const STAGE_PAGE_V2_FLAG_KEY = "stage_page_v2";

export async function isStagePageV2Enabled(supabase, opts = {}) {
  return evaluateFlagStage(await readFlagStage(supabase, STAGE_PAGE_V2_FLAG_KEY), opts);
}

/**
 * GET /api/races/stage-page-v2 → { enabled: boolean }.
 * Kraever login (loebssiden er auth-gated). En fejl giver enabled:false og
 * rapporteres, saa siden altid kan falde tilbage til den nuvaerende visning.
 */
export function createStagePageV2Router({ supabase, requireAuth, isViewerBetaTester, readLimiter, reportError = () => {} }) {
  const router = express.Router();
  router.get("/races/stage-page-v2", requireAuth, readLimiter, async (req, res) => {
    try {
      const isBetaTester = (await isViewerBetaTester(req)) === true;
      const enabled = await isStagePageV2Enabled(supabase, { isBetaTester });
      res.set("Cache-Control", "no-store");
      res.json({ enabled: enabled === true });
    } catch (error) {
      reportError(error, { tags: { route: "/races/stage-page-v2" } });
      res.json({ enabled: false });
    }
  });
  return router;
}
