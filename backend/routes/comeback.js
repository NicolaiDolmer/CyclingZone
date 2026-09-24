// #5643 (epik #4592, spor A4) · POST /api/season/comeback: et parkeret hold vender
// tilbage i ligaen med det samme, placeret efter Global Rank (comebackService.js).
//
// EGEN route-fil med vilje: backend/routes/api.js er låst af en anden bølge, så
// routeren monteres i server.js FØR apiRoutes. Den er bygget som en fabrik (samme
// mønster som api/featureFlagsApi.js), så testen kan give den en fake Supabase og en
// fake service uden at starte hele api.js.
//
// Gate: samme app_config-flag som tilmeldings-knappen, season_signup_enabled
// (seasonSignupFlag.js, "beta" gælder admin/beta-testere). Flag slået fra → 404, så
// endpointet ikke findes for spilleren, før knappen gør.
import express from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { AUTH_FAILURE_RESPONSES, verifyBearerToken } from "../lib/authTokenVerification.js";
import { isSeasonSignupEnabled } from "../lib/seasonSignupFlag.js";
import { returnParkedTeam, ComebackError } from "../lib/comebackService.js";
import { marketWriteLimiter } from "../lib/rateLimiters.js";
import { captureException, setSentryUser } from "../lib/sentry.js";

/**
 * Samme kontrakt som api.js' requireAuth: 401 uden/med afvist token, 503 når Supabase
 * ikke kan nås (#4369), ellers req.user + req.team (null hvis holdet ikke findes endnu).
 * api.js' egen funktion eksporteres ikke, og filen må ikke røres her; logikken bag
 * afgørelsen ligger i lib/authTokenVerification.js og deles derfra.
 */
export function createRequireAuth({ supabase, setSentryUserFn = setSentryUser }) {
  return async function requireAuth(req, res, next) {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) return res.status(401).json({ error: "Unauthorized" });

    const verdict = await verifyBearerToken(supabase, token);
    if (verdict.outcome === "unavailable") {
      console.warn(`[auth] 503 auth_unavailable ${req.method} ${req.originalUrl.split("?")[0]} (${verdict.reason})`);
      const unavailable = AUTH_FAILURE_RESPONSES.unavailable;
      return res.status(unavailable.status).json(unavailable.body);
    }
    if (verdict.outcome !== "authenticated") {
      console.warn(`[auth] 401 invalid_token ${req.method} ${req.originalUrl.split("?")[0]} (${verdict.reason})`);
      const rejected = AUTH_FAILURE_RESPONSES.rejected;
      return res.status(rejected.status).json(rejected.body);
    }

    // .maybeSingle(): "ingen række endnu" er lovligt (#3722) og giver req.team = null.
    // En ÆGTE læsefejl må ikke se ud som "intet hold", så den svarer 500.
    const { data: team, error: teamError } = await supabase
      .from("teams")
      .select("*")
      .eq("user_id", verdict.user.id)
      .maybeSingle();
    if (teamError) {
      captureException(teamError, { tags: { flow: "season_comeback", stage: "auth_team" } });
      return res.status(500).json({ error: "team_lookup_failed" });
    }
    req.user = verdict.user;
    req.team = team;
    setSentryUserFn(verdict.user.id);
    return next();
  };
}

// Admin eller users.is_beta_tester, samme læsning som api.js' isViewerBetaTester.
export async function isViewerBetaTester(supabase, req) {
  if (!req.user?.id) return false;
  const { data: u, error } = await supabase
    .from("users")
    .select("role, is_beta_tester")
    .eq("id", req.user.id)
    .maybeSingle();
  // En fejlet læsning giver "ikke beta-tester": den sikre retning for en gate, der kun
  // kan ÅBNE for flere (flaget "beta"). Fejlen er synlig i Sentry.
  if (error) {
    captureException(error, { tags: { flow: "season_comeback", stage: "beta_lookup" } });
    return false;
  }
  return u?.role === "admin" || u?.is_beta_tester === true;
}

/**
 * @param {object} deps
 * @param {object} deps.supabase                 service-klienten
 * @param {Function} [deps.requireAuth]          auth-middleware (default: createRequireAuth)
 * @param {Function} [deps.limiter]              rate-limiter (default: marketWriteLimiter)
 * @param {Function} [deps.isSignupEnabled]      (supabase, { isBetaTester }) => Promise<boolean>
 * @param {Function} [deps.isBetaTester]         (supabase, req) => Promise<boolean>
 * @param {Function} [deps.returnParkedTeamFn]   comebackService.returnParkedTeam
 * @param {Function} [deps.captureExceptionFn]   captureException i prod
 */
export function createComebackRouter({
  supabase,
  requireAuth = createRequireAuth({ supabase }),
  limiter = marketWriteLimiter,
  isSignupEnabled = isSeasonSignupEnabled,
  isBetaTester = isViewerBetaTester,
  returnParkedTeamFn = returnParkedTeam,
  captureExceptionFn = captureException,
} = {}) {
  if (!supabase?.from) throw new Error("createComebackRouter: a Supabase client is required");
  const router = express.Router();

  // Routeren står FØR api.js, så api.js' apiBaselineLimiter dækker den ikke. En direkte
  // rateLimit() pr. IP foran auth-laget (samme valg som featureFlagsApi.js, så CodeQL
  // js/missing-rate-limiting kan spore den); knappen trykkes én gang, så loftet er lavt.
  const comebackIpLimiter = rateLimit({
    windowMs: 60_000,
    limit: 20,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    keyGenerator: (req) => `season-comeback:${ipKeyGenerator(req.ip)}`,
    skip: () => process.env.RATE_LIMIT_DISABLED === "1",
    handler: (_req, res) => {
      res.set("Retry-After", "60");
      res.status(429).json({
        error: "Too many requests in a short time. Wait a moment.",
        errorCode: "rate_request",
        code: "rate_limited",
        limiter: "season-comeback",
        retry_after_seconds: 60,
      });
    },
  });

  // Monteret på /api/season/comeback i server.js.
  router.post("/", comebackIpLimiter, requireAuth, limiter, async (req, res) => {
    if (!req.team) return res.status(400).json({ error: "No team found" });
    try {
      const enabled = await isSignupEnabled(supabase, { isBetaTester: await isBetaTester(supabase, req) });
      if (!enabled) return res.status(404).json({ error: "not_found" });

      const result = await returnParkedTeamFn({ supabase, teamId: req.team.id, now: new Date() });
      return res.json({
        ok: true,
        returned: result.returned,
        already_returned: result.alreadyReturned,
        division: result.division,
        league_division_id: result.leagueDivisionId,
        pool_label: result.poolLabel,
        season_number: result.seasonNumber,
        sponsor: {
          paid: Boolean(result.sponsor?.paid),
          amount: Number(result.sponsor?.amount) || 0,
        },
      });
    } catch (err) {
      if (err instanceof ComebackError) {
        return res.status(err.status).json({ error: err.code });
      }
      captureExceptionFn(err, { tags: { flow: "season_comeback", stage: "route" } });
      return res.status(500).json({ error: "comeback_failed" });
    }
  });

  return router;
}
