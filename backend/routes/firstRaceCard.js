// #1140: GET /api/me/first-race-card. Alt "vis kortet?"-logik bor i
// lib/firstRaceCardFlag.js; ruten er kun auth + parameter + fejlhaandtering.
// Svaret er bare booleans/en dato, aldrig det raa flag-stadie eller viewerens
// beta-status (jf. featureFlagsApi.js).
import express from "express";
import { buildFirstRaceCardPayload } from "../lib/firstRaceCardFlag.js";

export function createFirstRaceCardRouter({ supabase, requireAuth, isViewerBetaTester, readLimiter, reportError = () => {} }) {
  const router = express.Router();

  router.get("/me/first-race-card", requireAuth, readLimiter, async (req, res) => {
    try {
      const previewParam = typeof req.query?.preview === "string" ? req.query.preview : undefined;
      const payload = await buildFirstRaceCardPayload(supabase, {
        userId: req.user?.id,
        team: req.team,
        isBetaTester: () => isViewerBetaTester(req),
        previewParam,
      });
      res.json(payload);
    } catch (error) {
      reportError(error, { tags: { route: "/me/first-race-card" } });
      // Fail-safe: en fejl skjuler kortet, den ydmyger ikke dashboardet.
      res.json({ visible: false, preview: false });
    }
  });

  return router;
}
