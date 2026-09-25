// #5753 (Mandat-launch B, epik #4859) · GET /api/board/verdict/:seasonId —
// "The board's verdict" som første highlight i sæsonrecappen (/seasons/:id).
//
// EGEN route-fil med vilje: backend/routes/api.js ejes af en anden bølge-lane, så
// routeren monteres i server.js FØR apiRoutes (samme mønster og begrundelse som
// routes/comeback.js). Fabrik, så testen kan give den fakes uden hele api.js.
//
// KONTRAKT (ren læsning, ingen skrivning):
//   200 { enabled: false }   flag slået fra for viewer (board_mandate_model_enabled,
//                            samme læse-gate som GET /board/room), intet hold,
//                            ikke-manager-hold, eller intet mandat i den sæson.
//   200 { enabled: true, seasonNumber, goalsMet, goalsTotal, confidenceBefore,
//         confidenceAfter, chairman, mandateStatus, meetingAvailable }
//        goalsMet/confidence* er null når mandatet endnu ikke har en eneste
//        kvittering (board_satisfaction_events med mandate_id) — recappen viser
//        så intet highlight i stedet for et opdigtet "0 af N".
//   400 invalid_season_id · 404 season_not_found · 500 board_verdict_failed.
//
// Datakilder: board_mandates (team_id, season_id), board_satisfaction_events
// (første række = satisfaction_before, seneste = satisfaction_after + goals_*),
// team_board_members (formanden), teams.team_dna_key (navne-afledning). Replikken
// kommer fra boardVoice.sampleVoiceLine (via boardRoom.sampleVoiceLineOrNull, så en
// tom bucket giver null i stedet for 500), seedet pr. mandat-id: samme sæson giver
// altid samme linje. meetingAvailable = præcis GET /board/meeting's regel, genbrugt
// via buildBoardMeetingPayload (ingen kopi).
import express from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { createRequireAuth, isViewerBetaTester } from "./comeback.js";
import { isBoardMandateModelEnabled } from "../lib/boardMandateFlag.js";
import { buildBoardMeetingPayload } from "../lib/boardMandateMeeting.js";
import { sampleVoiceLineOrNull } from "../lib/boardRoom.js";
import { generateBoardMemberNames } from "../lib/boardMandateNames.js";
import { presencePulseLimiter } from "../lib/rateLimiters.js";
import { captureException } from "../lib/sentry.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VERDICT_MANDATE_STATUSES = ["active", "completed"];

function numOrNull(value) {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Positiv kvittering når mindst halvdelen af målene er nået, ellers negativ. */
export function pickVerdictBeat(goalsMet, goalsTotal) {
  if (goalsMet == null || !goalsTotal) return null;
  return goalsMet / goalsTotal >= 0.5 ? "receipt_positive" : "receipt_negative";
}

async function must(query, label) {
  const { data, error } = await query;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data ?? null;
}

/**
 * Samler dommen for ÉT hold i ÉN sæson. Eksporteret så den kan testes uden Express.
 * @returns {Promise<object>} se modul-headerens kontrakt
 */
export async function buildBoardVerdict({
  supabase,
  teamId,
  seasonId,
  buildMeetingPayloadFn = buildBoardMeetingPayload,
  captureExceptionFn = captureException,
}) {
  const season = await must(
    supabase.from("seasons").select("id, number").eq("id", seasonId).maybeSingle(),
    "seasons",
  );
  if (!season) return { notFound: true };

  const mandate = await must(
    supabase.from("board_mandates")
      .select("id, status, season_number, goals")
      .eq("team_id", teamId)
      .eq("season_id", seasonId)
      .in("status", VERDICT_MANDATE_STATUSES)
      .order("signed_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    "board_mandates",
  );
  if (!mandate) return { enabled: false };

  // To afgrænsede opslag i stedet for hele feedet: første og seneste kvittering.
  // team_id står med for indeksets skyld (idx_board_satisfaction_events_team_id);
  // mandate_id har intet eget indeks, så filteret rammer kun holdets egne rækker.
  const [firstEvent, lastEvent, members, team] = await Promise.all([
    must(
      supabase.from("board_satisfaction_events")
        .select("satisfaction_before")
        .eq("team_id", teamId)
        .eq("mandate_id", mandate.id)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle(),
      "board_satisfaction_events (first)",
    ),
    must(
      supabase.from("board_satisfaction_events")
        .select("satisfaction_after, goals_met, goals_total")
        .eq("team_id", teamId)
        .eq("mandate_id", mandate.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      "board_satisfaction_events (last)",
    ),
    must(
      supabase.from("team_board_members")
        .select("archetype_key, is_chairman")
        .eq("team_id", teamId)
        .order("assigned_at", { ascending: true }),
      "team_board_members",
    ),
    must(
      supabase.from("teams").select("team_dna_key").eq("id", teamId).maybeSingle(),
      "teams",
    ),
  ]);

  const goalsMet = numOrNull(lastEvent?.goals_met);
  const goalsTotal = numOrNull(lastEvent?.goals_total)
    ?? (Array.isArray(mandate.goals) ? mandate.goals.length : null);

  const assignedMembers = members ?? [];
  const chairmanKey = assignedMembers.find((m) => m.is_chairman)?.archetype_key
    ?? assignedMembers[0]?.archetype_key
    ?? null;
  const dnaKey = team?.team_dna_key ?? null;

  let chairman = null;
  if (chairmanKey) {
    const beat = pickVerdictBeat(goalsMet, goalsTotal);
    const line = beat
      ? sampleVoiceLineOrNull({
        beat,
        archetypeKey: chairmanKey,
        seed: mandate.id,
        context: { teamId, dnaKey, members: assignedMembers },
      })
      : null;
    const named = generateBoardMemberNames({
      teamId,
      members: assignedMembers.length ? assignedMembers : [chairmanKey],
      dnaKey,
    }).find((m) => m.archetype_key === chairmanKey);
    chairman = {
      name: line?.member.navn ?? named?.full_name ?? null,
      initials: line?.member.initialer ?? named?.initials ?? null,
      archetypeKey: chairmanKey,
      quoteKey: line?.quote_key ?? null,
      quoteFallbackDa: line?.quote_fallback_da ?? null,
    };
  }

  // Best-effort: en fejl i møde-opslaget må ikke tage dommen med sig ned — knappen
  // falder bare tilbage til Boardroom.
  let meetingAvailable = false;
  try {
    const meeting = await buildMeetingPayloadFn({ supabase, teamId });
    meetingAvailable = meeting?.available === true;
  } catch (err) {
    captureExceptionFn(err, { tags: { flow: "board_verdict", stage: "meeting" } });
  }

  return {
    enabled: true,
    seasonNumber: season.number ?? mandate.season_number ?? null,
    goalsMet,
    goalsTotal,
    confidenceBefore: numOrNull(firstEvent?.satisfaction_before),
    confidenceAfter: numOrNull(lastEvent?.satisfaction_after),
    chairman,
    mandateStatus: mandate.status,
    meetingAvailable,
  };
}

/**
 * @param {object} deps
 * @param {object} deps.supabase                service-klienten
 * @param {Function} [deps.requireAuth]         auth-middleware (default: comeback.js' createRequireAuth)
 * @param {Function} [deps.limiter]             rate-limiter (default: presencePulseLimiter)
 * @param {Function} [deps.isEnabled]           (supabase, { isBetaTester }) => Promise<boolean>
 * @param {Function} [deps.isBetaTester]        (supabase, req) => Promise<boolean>
 * @param {Function} [deps.buildMeetingPayloadFn] boardMandateMeeting.buildBoardMeetingPayload
 * @param {Function} [deps.captureExceptionFn]  captureException i prod
 */
export function createBoardVerdictRouter({
  supabase,
  requireAuth = createRequireAuth({ supabase }),
  limiter = presencePulseLimiter,
  isEnabled = isBoardMandateModelEnabled,
  isBetaTester = isViewerBetaTester,
  buildMeetingPayloadFn = buildBoardMeetingPayload,
  captureExceptionFn = captureException,
} = {}) {
  if (!supabase?.from) throw new Error("createBoardVerdictRouter: a Supabase client is required");
  const router = express.Router();

  // Står FØR api.js, så apiBaselineLimiter dækker ikke. Direkte rateLimit() pr. IP
  // foran auth (CodeQL js/missing-rate-limiting), samme valg som comeback.js.
  const verdictIpLimiter = rateLimit({
    windowMs: 60_000,
    limit: 60,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    keyGenerator: (req) => `board-verdict:${ipKeyGenerator(req.ip)}`,
    skip: () => process.env.RATE_LIMIT_DISABLED === "1",
    handler: (_req, res) => {
      res.set("Retry-After", "60");
      res.status(429).json({
        error: "Too many requests in a short time. Wait a moment.",
        errorCode: "rate_request",
        code: "rate_limited",
        limiter: "board-verdict",
        retry_after_seconds: 60,
      });
    },
  });

  // Monteret på /api/board/verdict i server.js.
  router.get("/:seasonId", verdictIpLimiter, requireAuth, limiter, async (req, res) => {
    try {
      const { seasonId } = req.params;
      if (!UUID_RE.test(String(seasonId || ""))) return res.status(400).json({ error: "invalid_season_id" });

      // Flaget først (samme læse-gate som GET /board/room): slået fra læses intet andet.
      const enabled = await isEnabled(supabase, { isBetaTester: await isBetaTester(supabase, req) });
      if (!enabled) return res.json({ enabled: false });

      const team = req.team;
      // #1077 · bestyrelsen er kun for manager-hold. Recappen er best-effort, så
      // "ingen dom" frem for en fejlkode.
      if (!team?.id || team.is_ai || team.is_bank || team.is_frozen) return res.json({ enabled: false });

      const verdict = await buildBoardVerdict({
        supabase, teamId: team.id, seasonId, buildMeetingPayloadFn, captureExceptionFn,
      });
      if (verdict.notFound) return res.status(404).json({ error: "season_not_found" });
      return res.json(verdict);
    } catch (err) {
      captureExceptionFn(err, { tags: { flow: "board_verdict", stage: "route" } });
      return res.status(500).json({ error: "board_verdict_failed" });
    }
  });

  return router;
}
