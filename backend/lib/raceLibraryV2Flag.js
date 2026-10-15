// #6514: kalenderens løbskort, status-prikken og Løbshistorik bag stadie-flaget
// `race_library_v2` (off | beta | on, featureStage.js). Mønster kopieret fra
// stagePageV2Flag.js.
//
// EJER 15/10: byg bag beta-flag. Migrationen
// (database/2026-10-15-6514-race-library-v2-flag.sql) opretter rækken med stadie
// "off"; ejeren flytter den fra admin-fladen. Alle andre end beta-testere ser
// kalenderen og arkivet uændret, også i beta-stadiet.
//
// Beta-status læses SERVER-SIDE (isViewerBetaTester i routes/api.js) og aldrig
// fra klienten. Svaret er en bar boolean, aldrig det rå stadie.
//
// Fail-safe: manglende/ukendt værdi eller fejl giver false, dvs. den nuværende visning.

import express from "express";
import { readFlagStage, evaluateFlagStage } from "./featureStage.js";

export const RACE_LIBRARY_V2_FLAG_KEY = "race_library_v2";

export async function isRaceLibraryV2Enabled(supabase, opts = {}) {
  return evaluateFlagStage(await readFlagStage(supabase, RACE_LIBRARY_V2_FLAG_KEY), opts);
}

/**
 * GET /api/races/race-library-v2 → { enabled: boolean }.
 * Kræver login. En fejl giver enabled:false og rapporteres, så kalenderen og
 * arkivet altid kan falde tilbage til den nuværende visning.
 */
export function createRaceLibraryV2Router({ supabase, requireAuth, isViewerBetaTester, readLimiter, reportError = () => {} }) {
  const router = express.Router();
  router.get("/races/race-library-v2", requireAuth, readLimiter, async (req, res) => {
    try {
      const isBetaTester = (await isViewerBetaTester(req)) === true;
      const enabled = await isRaceLibraryV2Enabled(supabase, { isBetaTester });
      res.set("Cache-Control", "no-store");
      res.json({ enabled: enabled === true });
    } catch (error) {
      // best-effort: rapporteret via reportError (captureException i api.js); en
      // fejl viser den nuværende kalender, den vælter ikke siden.
      reportError(error, { tags: { route: "/races/race-library-v2" } });
      res.json({ enabled: false });
    }
  });
  return router;
}
