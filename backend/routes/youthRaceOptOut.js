// #5944 · /api/youth-race-opt-out — "Enter races" / "Train only" pr. ungdomstrup.
//
// Samme fabrik-moenster som routes/trainingFatigueRules.js: egen fil, fake Supabase
// i testen, monteret i api.js. Intet beta-flag (ejer-go 1/10: live for alle ved
// merge; standard er uaendret "Enter races").
//
//   GET /?squad=u23|junior → { available, squad, trainOnly, effectiveFromDay }
//   PUT /:squad { mode: "enter" | "train_only" }
//        → { squad, trainOnly, clearedRaces, effectiveFromDay }
//
// effectiveFromDay = foerste ulaaste loebsdag for truppen (races.game_day_start),
// dagen skiftet faar virkning fra. Reglerne bor i lib/youthRaceOptOut.ts.

import express from "express";
import {
  firstUnlockedRaceDay, isOptOutSquad, loadTeamTrainOnly, setTeamSquadTrainOnly,
} from "../lib/youthRaceOptOut.ts";

const PASS = (_req, _res, next) => next();
const MODES = new Set(["enter", "train_only"]);

export function createYouthRaceOptOutRouter({
  supabase, requireAuth, writeLimiter = PASS, readLimiter = PASS, captureExceptionFn = () => {},
}) {
  const router = express.Router();

  router.get("/", requireAuth, readLimiter, async (req, res) => {
    if (!req.team) return res.status(400).json({ error: "No team found" });
    const squad = req.query.squad;
    if (!isOptOutSquad(squad)) return res.status(400).json({ error: "invalid_squad" });
    try {
      const state = await loadTeamTrainOnly(supabase, req.team.id);
      const effectiveFromDay = state.available
        ? await firstUnlockedRaceDay(supabase, { team: req.team, squad })
        : null;
      res.json({ available: state.available, squad, trainOnly: state[squad], effectiveFromDay });
    } catch (err) {
      captureExceptionFn(err);
      res.status(500).json({ error: "opt_out_load_failed" });
    }
  });

  router.put("/:squad", requireAuth, writeLimiter, async (req, res) => {
    if (!req.team) return res.status(400).json({ error: "No team found" });
    const { squad } = req.params;
    if (!isOptOutSquad(squad)) return res.status(400).json({ error: "invalid_squad" });
    const mode = req.body?.mode;
    if (!MODES.has(mode)) return res.status(400).json({ error: "invalid_mode" });
    try {
      const result = await setTeamSquadTrainOnly(supabase, {
        team: req.team, squad, trainOnly: mode === "train_only",
      });
      res.json({
        squad,
        trainOnly: result.trainOnly,
        clearedRaces: result.clearedRaceIds.length,
        effectiveFromDay: result.effectiveFromDay,
      });
    } catch (err) {
      if (err?.code === "opt_out_unavailable") return res.status(503).json({ error: "opt_out_unavailable" });
      captureExceptionFn(err);
      res.status(500).json({ error: "opt_out_save_failed" });
    }
  });

  return router;
}
