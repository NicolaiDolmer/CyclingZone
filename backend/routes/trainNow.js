// #4847 · /api/training/train-now — "Train now" without bonus.
//
// Own route file (same factory pattern as trainingPrograms.js): api.js is shared
// by many lanes, and the test can give the router a fake Supabase. Mounted in
// api.js BEFORE `/training/:riderId`, so "train-now" is never matched as a rider id.
//
//   GET  /  -> panel state (enabled, available, locked, reason). Never 404s, so the
//              page can ask without knowing the flag.
//   POST /  -> the press (backend/lib/trainNow.js). 404 when the flag is off for
//              the viewer: the function does not exist for that player.

import express from "express";
import { loadTrainNowStatus, runTrainNow } from "../lib/trainNow.js";

const PASS = (_req, _res, next) => next();

export function createTrainNowRouter({
  supabase, requireAuth, isViewerBetaTester, loadActiveSeason, loadDaySpans,
  writeLimiter = PASS, captureExceptionFn = () => {}, run = runTrainNow, status = loadTrainNowStatus,
}) {
  const router = express.Router();

  router.get("/", requireAuth, async (req, res) => {
    if (!req.team) return res.status(400).json({ error: "No team found" });
    try {
      const isBetaTester = await isViewerBetaTester(req);
      const season = await loadActiveSeason();
      res.json(await status({ supabase, team: req.team, seasonId: season?.id ?? null, isBetaTester }));
    } catch (err) {
      captureExceptionFn(err);
      res.status(500).json({ error: err.message });
    }
  });

  router.post("/", requireAuth, writeLimiter, async (req, res) => {
    if (!req.team) return res.status(400).json({ error: "No team found" });
    try {
      const isBetaTester = await isViewerBetaTester(req);
      const season = await loadActiveSeason();
      const result = await run({ supabase, team: req.team, season, isBetaTester, loadDaySpans });
      res.status(result.status).json(result.body);
    } catch (err) {
      captureExceptionFn(err);
      res.status(500).json({ error: "train_now_failed" });
    }
  });

  return router;
}
