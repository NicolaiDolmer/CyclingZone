// #4948 · GET /api/feature-flags: det lette, globale svar paa "er denne
// funktion taendt for MIG?" for de flag en spillerflade maa spoerge om.
//
// ── HVORFOR ET EGET ENDPOINT ────────────────────────────────────────────────
// Hjaelp-siden havde tre flag-gatede dele og tre forskellige mekanismer:
// mandatet spurgte GET /board/room, "raceDay" var hardkodet skjult fordi
// race_engine_v4 kun var spiller-synligt paa et per-loeb-endpoint, og
// traenings-blokkene var hardkodet til den gamle model. Dette endpoint er den
// ene mekanisme, saa en flade kan foelge flaget i stedet for en kodelinje der
// skal flippes i haanden samme dag som flaget.
//
// ── HVAD DET ALDRIG GOER ───────────────────────────────────────────────────
// Det laeser KUN noeglerne i PLAYER_VISIBLE_FLAG_KEYS (stageFlagCatalog.js),
// aldrig "alle app_config-raekker": app_config rummer ogsaa tal, tidsstempler
// og ops-kontakter der ikke er spillerens. Svaret er booleans, aldrig det raa
// stadie, saa "beta" og vaerdien i databasen ikke laekker til en spiller der
// ikke er beta-tester.
//
// ── HVEM SPOERGER ──────────────────────────────────────────────────────────
// /help er offentlig (#2042), saa endpointet kraever IKKE login:
//   - uden Authorization-header: evalueret som en anonym spiller (on = true,
//     beta og off = false).
//   - med header: den kanoniske requireAuth (et ugyldigt token faar 401 som
//     alle andre ruter), og derefter samme laese-gate som /board/room:
//     admin/beta-tester ser ogsaa beta-stadiet.
// Evalueringen er featureStage.js' readFlagStage + evaluateFlagStage, praecis
// som de tre *Flag.js-moduler bag noeglerne, saa svaret ikke kan afvige fra
// det serveren selv beslutter for den samme viewer.
import express from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { evaluateFlagStage, readFlagStage } from "../lib/featureStage.js";
import { PLAYER_VISIBLE_FLAG_KEYS } from "../lib/stageFlagCatalog.js";

/**
 * { <noegle>: boolean } for hver noegle i allowlisten. Fejl i et enkelt opslag
 * er "off" (readFlagStage er fail-safe), aldrig en kastet fejl.
 *
 * Opslagene staar bevidst IKKE som `evaluateFlagStage(await readFlagStage(..))`:
 * katalogets forward-guard (#5259) scanner netop den form og ville laese
 * loop-variablen som en ukendt noegle. Allowlisten er i stedet bundet til
 * kataloget af endpointets egen test.
 */
export async function readPlayerFeatureFlags(supabase, { isBetaTester = false } = {}) {
  const keys = PLAYER_VISIBLE_FLAG_KEYS;
  const stages = await Promise.all(keys.map((key) => readFlagStage(supabase, key)));
  return Object.fromEntries(keys.map((key, i) => [key, evaluateFlagStage(stages[i], { isBetaTester })]));
}

/**
 * @param {object} deps
 * @param {object} deps.supabase             service-klienten (samme som api.js)
 * @param {Function} deps.requireAuth        api.js' kanoniske auth-middleware
 * @param {Function} deps.isViewerBetaTester (req) => Promise<boolean>, api.js' laese-gate
 * @param {Function} [deps.reportError]      (error, context) — captureException i prod
 */
export function createFeatureFlagsRouter({ supabase, requireAuth, isViewerBetaTester, reportError = () => {} }) {
  const router = express.Router();

  // Offentligt endpoint → et direkte rateLimit()-kald (ikke buildLimiter-
  // factory'en), saa CodeQL js/missing-rate-limiting kan spore det; samme valg
  // som collectLimiter i api.js. Siden spoerger én gang pr. visning, saa
  // loftet er rigeligt for flere spillere bag samme NAT.
  const featureFlagsLimiter = rateLimit({
    windowMs: 60_000,
    limit: 60,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    keyGenerator: (req) => `feature-flags:${ipKeyGenerator(req.ip)}`,
    skip: () => process.env.RATE_LIMIT_DISABLED === "1",
    handler: (_req, res) => {
      res.set("Retry-After", "60");
      res.status(429).json({
        error: "Too many requests in a short time. Wait a moment.",
        errorCode: "rate_request",
        code: "rate_limited",
        limiter: "feature-flags",
        retry_after_seconds: 60,
      });
    },
  });

  function fail(error, req, res) {
    reportError(error, { tags: { route: "/feature-flags", method: req.method } });
    if (!res.headersSent) res.status(500).json({ error: "Could not read feature flags" });
  }

  async function sendFlags(req, res, { authenticated }) {
    try {
      const isBetaTester = authenticated ? (await isViewerBetaTester(req)) === true : false;
      const flags = await readPlayerFeatureFlags(supabase, { isBetaTester });
      // Svaret afhaenger af viewerens beta-status og af et flag ejeren kan
      // flippe naar som helst: ingen cache, heller ikke i browseren.
      res.set("Cache-Control", "no-store");
      res.json({ flags });
    } catch (error) {
      fail(error, req, res);
    }
  }

  router.get("/", featureFlagsLimiter, async (req, res) => {
    if (!req.headers.authorization) return sendFlags(req, res, { authenticated: false });
    try {
      await requireAuth(req, res, () => sendFlags(req, res, { authenticated: true }));
    } catch (error) {
      fail(error, req, res);
    }
  });

  return router;
}
