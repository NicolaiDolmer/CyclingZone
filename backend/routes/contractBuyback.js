// #7251 · Tilbagekøbsret (ejer 26/10, valg A):
//   GET  /api/contracts/buyback          → holdets kandidater (frigivet uden varsel ved S4→S5)
//   POST /api/contracts/buyback/:riderId → gen-sign til normal løn, 1 sæson, uden signing fee
//
// Egen route-fil (samme mønster som comeback.js): fabrik med injicerbar Supabase, så
// testen kører uden hele api.js. Ingen flag: retten gælder kun ryttere i S4→S5-vinduet
// og udløber af sig selv efter 7 dage (BUYBACK_7251).
import express from "express";
import { createRequireAuth } from "./comeback.js";
import { loadBuybackCandidates, buybackRider, BuybackError } from "../lib/contractBuyback7251.js";
import { marketWriteLimiter } from "../lib/rateLimiters.js";
import { captureException } from "../lib/sentry.js";

export function createContractBuybackRouter({ supabase, requireAuth = createRequireAuth({ supabase }), writeLimiter = marketWriteLimiter }) {
  const router = express.Router();

  router.get("/", requireAuth, async (req, res) => {
    if (!req.team) return res.json({ candidates: [] });
    try {
      const candidates = await loadBuybackCandidates({ supabase, team: req.team });
      return res.json({ candidates });
    } catch (err) {
      captureException(err, { tags: { flow: "contract_buyback", stage: "list" } });
      return res.status(500).json({ error: "buyback_lookup_failed" });
    }
  });

  router.post("/:riderId", requireAuth, writeLimiter, async (req, res) => {
    if (!req.team) return res.status(403).json({ error: "buyback_no_team" });
    try {
      const result = await buybackRider({ supabase, team: req.team, riderId: req.params.riderId });
      return res.json({ ok: true, ...result });
    } catch (err) {
      if (err instanceof BuybackError) return res.status(err.status).json({ error: err.code });
      captureException(err, { tags: { flow: "contract_buyback", stage: "sign" }, riderId: req.params.riderId });
      return res.status(500).json({ error: "buyback_failed" });
    }
  });

  return router;
}
