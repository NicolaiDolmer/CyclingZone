// #8592 · "Kun denne dag": et pas for én rytter (flere eller en gruppe) på én dato i den
// rullende uge. Ejerbeslutning 26/11 på #8592 (seks punkter) og #8819 (to svar plus Fable-dommens
// fire fund). Dommer-scenarier DO-1..DO-15: docs/audits/8592-kun-denne-dag-dommer-scenarier.md.
//
// Forrang (motor og prognose, samme funktion):
//   løb / binding / skade > træthedsgrænsen (medmindre valget er nyere, DO-10) > dato-valget
//   > rotation > ugeblok > ugedag > plan.
// Ugeplanen ændres aldrig; dato-valget bor i sin egen tabel (training_day_overrides) og
// gælder kun sin dato. Dagen efter læser motoren intet valg, og planen kører igen.
// Det virker for alle hold, også uden program (#8819, DO-11): uden program er planen den samme
// som i går, og valget erstatter den kun på datoen.
//
// Kontakt `training_day_override_8592` (off | beta | on), seedet off. Off = motoren læser
// kontakten, men aldrig tabellen, og API'et afviser skrivning med 409 feature_disabled.
import express from "express";
import { readFlagStage, evaluateFlagStage } from "./featureStage.js";
import { isProgramSession, programForSession } from "./trainingPrograms.js";
import { isV3OnlySession, isTrainingCatalogV3EnabledForViewer } from "./trainingCatalogV3.js";
import { applyFatigueRules } from "./trainingFatigueRules.ts";
import { copenhagenDateString } from "./copenhagenTime.js";

export const TRAINING_DAY_OVERRIDE_FLAG_KEY = "training_day_override_8592";
export const DAY_OVERRIDE_TABLE = "training_day_overrides";
/** Den rullende uge: i morgen og seks dage mere (ejer punkt 5, "de næste 7 dage"). */
export const DAY_OVERRIDE_WINDOW_DAYS = 7;
/** Største antal ryttere i én skrivning (en hel trup er langt under). */
export const DAY_OVERRIDE_MAX_RIDERS = 60;
/** Hvor langt tilbage skærmen viser, hvordan valgene gik (efter datoen, #8819 fund 1). */
export const DAY_OVERRIDE_RECENT_DAYS = 7;

const YMD = /^\d{4}-\d{2}-\d{2}$/;

// ── Kontakten ─────────────────────────────────────────────────────────────

/** Viewerens svar (API'et): beta = kun beta-testere. Fejl = off (featureStage fail-safe). */
export async function isDayOverrideEnabled(supabase, { isBetaTester = false } = {}) {
  return evaluateFlagStage(await readFlagStage(supabase, TRAINING_DAY_OVERRIDE_FLAG_KEY, { fresh: true }), { isBetaTester });
}

/**
 * Motorens svar for holdet (som training_week_priority): kan kontakten ikke læses, er den off,
 * og planen kører. På beta kaster et fejlet ejer-opslag, så datoen prøves igen og aldrig
 * afregnes halvt med og halvt uden valget.
 */
export async function isDayOverrideEnabledForTeam(supabase, teamId) {
  const stage = await readFlagStage(supabase, TRAINING_DAY_OVERRIDE_FLAG_KEY, { fresh: true });
  if (stage === true || stage === "on") return true;
  if (stage !== "beta") return false;
  const { data: team, error: teamError } = await supabase.from("teams").select("user_id").eq("id", teamId).maybeSingle();
  if (teamError) throw new Error(`training_day_override owner load (team ${teamId}): ${teamError.message ?? teamError}`);
  if (!team?.user_id) return false;
  const { data: user, error: userError } = await supabase.from("users").select("role, is_beta_tester").eq("id", team.user_id).maybeSingle();
  if (userError) throw new Error(`training_day_override owner beta load (team ${teamId}): ${userError.message ?? userError}`);
  return user?.role === "admin" || user?.is_beta_tester === true;
}

// ── Datoerne ──────────────────────────────────────────────────────────────

export function addDaysYmd(ymd, n) {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** De datoer et valg kan gælde: i dag + 1 til og med i dag + 7 (DO-7). */
export function overrideWindow(today) {
  return Array.from({ length: DAY_OVERRIDE_WINDOW_DAYS }, (_, i) => addDaysYmd(today, i + 1));
}

export function isOverrideDate(date, today) {
  return typeof date === "string" && YMD.test(date) && overrideWindow(today).includes(date);
}

// ── Motorens regel (ren) ──────────────────────────────────────────────────

/**
 * Datoens pas som (fokus, intensitet), via samme vej som en programcelle (programForSession).
 * Hvile bevarer rytterens fokus. Et pas kataloget ikke kan levere (fx et v3-pas med kataloget
 * slukket) giver null, og planen gælder.
 */
export function overrideProgram({ override, previousFocus = null, catalogV3 = false, effortLevels = false }) {
  if (!override || !isProgramSession(override.session)) return null;
  const chosen = programForSession(override.session, previousFocus, { catalogV3, effort: null, effortLevels });
  return chosen?.ok ? { focus: chosen.focus, intensity: chosen.intensity } : null;
}

/**
 * DO-10 (ejer 26/11, #8819: nyeste information vinder). Valget går forud for træthedsgrænsen,
 * når spilleren traf det, mens grænsen synligt havde erstattet dagen (rækkens beats_fatigue_rule),
 * og valget faktisk kan køres. Ellers bestemmer grænsen, og feltet stemples "fatigue_rule".
 */
export function overrideBeatsFatigueRule(override, appliedProgram) {
  return !!(override?.beatsRule && appliedProgram);
}

/**
 * Markeringen på feltets kvittering (ejer punkt 4): hvad der skete med valget i netop dette felt.
 * "race" | "bound_rest" | "injured" | "unknown" | "unavailable" | "fatigue_rule" | "trained".
 */
export function overrideOutcome({ raced = false, boundRest = false, injured = false, unknown = false, fatigueRule = null, applied = true }) {
  if (unknown) return "unknown";
  if (raced) return "race";
  if (boundRest) return "bound_rest";
  if (injured) return "injured";
  if (!applied) return "unavailable";
  if (fatigueRule) return "fatigue_rule";
  return "trained";
}

export function overrideStamp({ override, ...facts }) {
  return {
    session: override.session, outcome: overrideOutcome(facts),
    ...(override.beatsRule ? { beats_fatigue_rule: true } : {}),
  };
}

// Det vigtigste, der tog valget, vinder sammendraget (samme rækkefølge som overrideOutcome).
const OUTCOME_RANK = ["unknown", "race", "bound_rest", "injured", "unavailable", "fatigue_rule"];

/**
 * Feltenes markeringer for én rytter på én dato → det, skærmen siger (#8819 fund 1):
 * { outcome, some } hvor outcome er "trained" eller det, der tog valget, og some = kun nogle felter.
 * Ingen markeringer = null.
 */
export function summarizeOverrideOutcomes(outcomes) {
  const list = (outcomes ?? []).filter((o) => typeof o === "string");
  if (list.length === 0) return null;
  const taken = list.filter((o) => o !== "trained");
  if (taken.length === 0) return { outcome: "trained", some: false };
  const outcome = OUTCOME_RANK.find((o) => taken.includes(o)) ?? taken[0];
  return { outcome, some: taken.length < list.length };
}

/**
 * DO-10: grænsens markering for i morgen, som spilleren ser den i dag (dagsvælgeren). Tallet er
 * aftenens prognose for i dag, som er morgendagens start; samme regel som motoren (felt 1).
 * Map(rider_id → { kind, fallback }). Uden prognose eller regler: tom.
 */
export function fatigueRuleMarksAhead({ today, rules }) {
  const out = new Map();
  if (!rules || !today?.available || !today.riders) return out;
  for (const [riderId, entry] of Object.entries(today.riders)) {
    const fatigue = Number(entry?.fatigue);
    if (entry?.fatigue == null || !Number.isFinite(fatigue)) continue;
    // Prøvepasset er et normalt pas, så enhver erstatning (let, restitution, hvile) slår igennem.
    const { stamp } = applyFatigueRules({
      program: { focus: "endurance", intensity: "normal" }, rule: rules.forRider(riderId),
      fatigueAtDateStart: fatigue, slotIndex: 0, rodeStagePreviousDate: (entry.raceSlots?.length ?? 0) > 0,
    });
    if (stamp) out.set(riderId, { kind: stamp.kind, fallback: stamp.fallback });
  }
  return out;
}

// ── Læsning ───────────────────────────────────────────────────────────────

const rowOverride = (row) => ({ session: row.session, beatsRule: row.beats_fatigue_rule === true });

/** Datoens valg for holdet: Map(rider_id → { session, beatsRule }). Fejl kaster (datoen prøves igen). */
export async function loadDateOverrides({ supabase, teamId, tickDate }) {
  // pagination-safe: one team roster on one date (UNIQUE team_id, rider_id, override_date).
  // schema-columns-ok: training_day_overrides is created by database/2026-11-26-8592-training-day-overrides.sql (post-merge); only read with the switch on.
  const { data, error } = await supabase.from(DAY_OVERRIDE_TABLE).select("rider_id, session, beats_fatigue_rule")
    .eq("team_id", teamId).eq("override_date", tickDate);
  if (error) throw new Error(`training day overrides (team ${teamId}, ${tickDate}): ${error.message ?? error}`);
  return new Map((data ?? []).filter((row) => isProgramSession(row.session)).map((row) => [row.rider_id, rowOverride(row)]));
}

/**
 * Motorens indgang. `gate` er kontaktens svar for holdet (læst i motorens fælles opslag): off =
 * intet opslag i tabellen, og motoren er præcis som før (DO-8). Ingen valg = null.
 */
export async function loadEngineDateOverrides({ supabase, teamId, tickDate, gate }) {
  if (!gate) return null;
  const map = await loadDateOverrides({ supabase, teamId, tickDate });
  return map.size ? map : null;
}

/** Holdets valg fra i dag og frem: Map(date → Map(rider_id → { session, beatsRule })). */
export async function loadWeekDateOverrides({ supabase, teamId, today }) {
  // pagination-safe: one roster x at most eight dates.
  // schema-columns-ok: training_day_overrides is created by database/2026-11-26-8592-training-day-overrides.sql (post-merge); only read with the switch on.
  const { data, error } = await supabase.from(DAY_OVERRIDE_TABLE).select("rider_id, override_date, session, beats_fatigue_rule")
    .eq("team_id", teamId).gte("override_date", today).lte("override_date", addDaysYmd(today, DAY_OVERRIDE_WINDOW_DAYS));
  if (error) throw new Error(`training day overrides week (team ${teamId}): ${error.message ?? error}`);
  const out = new Map();
  for (const row of data ?? []) {
    if (!isProgramSession(row.session)) continue;
    if (!out.has(row.override_date)) out.set(row.override_date, new Map());
    out.get(row.override_date).set(row.rider_id, rowOverride(row));
  }
  return out;
}

/**
 * DO-9 (#8819 fund 2): et valg fra en tidligere dato bevares, til datoen er gjort op for holdet
 * (training_date_work = complete). En dato, der stadig er pending eller partial, prøves igen
 * af motoren med datoens eget valg, så rækken må ikke forsvinde før.
 */
export async function deleteExpiredOverrides({ supabase, teamId, today }) {
  // pagination-safe: one roster x the few past dates still waiting (at most a week of rows).
  const { data: stale, error } = await supabase.from(DAY_OVERRIDE_TABLE).select("override_date")
    .eq("team_id", teamId).lt("override_date", today);
  if (error) throw new Error(`training day overrides cleanup read (team ${teamId}): ${error.message ?? error}`);
  const dates = [...new Set((stale ?? []).map((row) => row.override_date))];
  if (dates.length === 0) return;
  // pagination-safe: one team x a few dates (one row per season and date).
  const { data: work, error: workError } = await supabase.from("training_date_work").select("tick_date, status")
    .eq("team_id", teamId).in("tick_date", dates);
  if (workError) throw new Error(`training day overrides cleanup work (team ${teamId}): ${workError.message ?? workError}`);
  const byDate = new Map();
  for (const row of work ?? []) {
    if (!byDate.has(row.tick_date)) byDate.set(row.tick_date, []);
    byDate.get(row.tick_date).push(row.status);
  }
  const settled = dates.filter((date) => byDate.get(date)?.length && byDate.get(date).every((status) => status === "complete"));
  if (settled.length === 0) return;
  const { error: deleteError } = await supabase.from(DAY_OVERRIDE_TABLE).delete().eq("team_id", teamId).in("override_date", settled);
  if (deleteError) throw new Error(`training day overrides cleanup (team ${teamId}): ${deleteError.message ?? deleteError}`);
}

/**
 * #8819 fund 1 (efter datoen): sådan gik holdets valg de seneste dage, fra feltenes kvitteringer.
 * [{ date, riderId, session, outcome, some, beatsRule }], nyeste dato først.
 */
export async function loadRecentOverrideOutcomes({ supabase, teamId, today }) {
  const since = addDaysYmd(today, -DAY_OVERRIDE_RECENT_DAYS);
  // pagination-safe: one roster x seven dates x five fields, only rows that carry a day choice.
  const { data, error } = await supabase.from("training_rider_ticks")
    .select("rider_id, tick_date, game_day, date_override:report->date_override")
    .eq("team_id", teamId).gte("tick_date", since).lt("tick_date", today)
    .not("report->date_override", "is", null)
    .order("tick_date", { ascending: false }).limit(1000);
  if (error) throw new Error(`training day overrides recent (team ${teamId}): ${error.message ?? error}`);
  const byKey = new Map();
  for (const row of data ?? []) {
    const stamp = row.date_override;
    if (!stamp || typeof stamp !== "object" || !isProgramSession(stamp.session)) continue;
    const key = `${row.tick_date}:${row.rider_id}`;
    if (!byKey.has(key)) byKey.set(key, { date: row.tick_date, riderId: row.rider_id, session: stamp.session, beatsRule: false, outcomes: [] });
    const entry = byKey.get(key);
    entry.outcomes.push(stamp.outcome);
    if (stamp.beats_fatigue_rule === true) entry.beatsRule = true;
  }
  return [...byKey.values()].map(({ outcomes, ...entry }) => ({ ...entry, ...summarizeOverrideOutcomes(outcomes) }))
    .filter((entry) => entry.outcome)
    .sort((a, b) => b.date.localeCompare(a.date) || a.riderId.localeCompare(b.riderId));
}

const plainOverride = (o) => ({ session: o.session, ...(o.beatsRule ? { beatsRule: true } : {}) });

/**
 * Ugens svar får datoens valg pr. rytter på hver dag (`dayOverrides`) og, for i morgen,
 * grænsens markering (`fatigueRuleAhead`, DO-10). Uden valg og markeringer: uændret.
 */
export function attachDayOverrides(week, byDate, { ruleMarks = null } = {}) {
  if (!week?.available || !Array.isArray(week.days)) return week;
  for (const day of week.days) {
    const map = byDate?.get(day.date);
    if (map?.size) day.dayOverrides = Object.fromEntries([...map].map(([id, o]) => [id, plainOverride(o)]));
  }
  if (ruleMarks?.size && week.days[1]) week.days[1].fatigueRuleAhead = Object.fromEntries(ruleMarks);
  return week;
}

// ── Skrivning (ren validering) ────────────────────────────────────────────

/** Body → { ok, riderIds?, groupId?, date, session? } eller { ok:false, status, reason }. */
export function parseOverrideWrite(body, { today, needSession = true }) {
  const date = body?.date;
  if (!isOverrideDate(date, today)) return { ok: false, status: 400, reason: "invalid_date" };
  const groupId = typeof body?.groupId === "string" && body.groupId ? body.groupId : null;
  const riderIds = Array.isArray(body?.riderIds) ? [...new Set(body.riderIds.filter((id) => typeof id === "string" && id))] : [];
  if (!groupId && riderIds.length === 0) return { ok: false, status: 400, reason: "invalid_riders" };
  if (riderIds.length > DAY_OVERRIDE_MAX_RIDERS) return { ok: false, status: 400, reason: "invalid_riders" };
  if (needSession && !isProgramSession(body?.session)) return { ok: false, status: 400, reason: "invalid_session" };
  return { ok: true, date, groupId, riderIds, session: needSession ? body.session : null };
}

// ── Ruterne: /api/training/programs/day-overrides ─────────────────────────

const PASS = (_req, _res, next) => next();

/**
 * `fatigueRuleAhead(req, date)` → Map(rider_id → markering): grænsens markering for datoen,
 * som spilleren ser den lige nu (kun i morgen har en). Serveren afgør selv, om et valg er
 * truffet efter markeringen (DO-10); klienten sender intet om det.
 */
export function createDayOverrideRouter({
  supabase, requireAuth, isViewerBetaTester, writeLimiter = PASS, readLimiter = PASS, captureExceptionFn = () => {},
  clock = () => new Date(), fatigueRuleAhead = async () => new Map(),
}) {
  const router = express.Router();
  const today = () => copenhagenDateString(clock());
  const enabled = async (req) => isDayOverrideEnabled(supabase, { isBetaTester: await isViewerBetaTester(req) });

  async function ownRiderIds(teamId) {
    // pagination-safe: one team roster (senior + academy), far below the 1000-row cap.
    const { data, error } = await supabase.from("riders").select("id").eq("team_id", teamId).eq("is_retired", false);
    if (error) throw new Error(error.message);
    return new Set((data ?? []).map((row) => row.id));
  }

  async function groupMemberIds(teamId, groupId) {
    // pagination-safe: one group on one team.
    const { data, error } = await supabase.from("training_group_members").select("rider_id").eq("team_id", teamId).eq("group_id", groupId);
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => row.rider_id);
  }

  async function targets(req, parsed) {
    const own = await ownRiderIds(req.team.id);
    const ids = parsed.groupId ? await groupMemberIds(req.team.id, parsed.groupId) : parsed.riderIds;
    if (ids.length === 0) return { ok: false, status: 400, reason: "invalid_riders" };
    if (ids.some((id) => !own.has(id))) return { ok: false, status: 403, reason: "not_own_rider" };
    return { ok: true, ids };
  }

  router.get("/", requireAuth, readLimiter, async (req, res) => {
    if (!req.team) return res.status(400).json({ error: "No team found" });
    try {
      if (!(await enabled(req))) return res.json({ enabled: false, overrides: [] });
      const now = today();
      await deleteExpiredOverrides({ supabase, teamId: req.team.id, today: now });
      const [byDate, recent] = await Promise.all([
        loadWeekDateOverrides({ supabase, teamId: req.team.id, today: now }),
        loadRecentOverrideOutcomes({ supabase, teamId: req.team.id, today: now }),
      ]);
      const overrides = [...byDate].flatMap(([date, map]) => [...map].map(([riderId, o]) => ({ riderId, date, ...plainOverride(o) })));
      res.json({ enabled: true, today: now, window: overrideWindow(now), overrides, recent });
    } catch (err) {
      captureExceptionFn(err);
      res.status(500).json({ error: err.message });
    }
  });

  // PUT body { riderIds?: string[], groupId?: string, date: "YYYY-MM-DD", session }
  router.put("/", requireAuth, writeLimiter, async (req, res) => {
    if (!req.team) return res.status(400).json({ error: "No team found" });
    try {
      if (!(await enabled(req))) return res.status(409).json({ error: "feature_disabled" });
      const now = today();
      const parsed = parseOverrideWrite(req.body, { today: now });
      if (!parsed.ok) return res.status(parsed.status).json({ error: parsed.reason });
      if (isV3OnlySession(parsed.session) && !(await isTrainingCatalogV3EnabledForViewer(supabase, () => isViewerBetaTester(req)))) {
        return res.status(400).json({ error: "invalid_session" });
      }
      const target = await targets(req, parsed);
      if (!target.ok) return res.status(target.status).json({ error: target.reason });
      // DO-10: et valg truffet, mens grænsen synligt har erstattet dagen, går forud for grænsen.
      const marks = await fatigueRuleAhead(req, parsed.date);
      await deleteExpiredOverrides({ supabase, teamId: req.team.id, today: now });
      const at = clock().toISOString();
      const rows = target.ids.map((riderId) => ({
        team_id: req.team.id, rider_id: riderId, override_date: parsed.date, session: parsed.session,
        beats_fatigue_rule: marks?.has(riderId) === true, updated_at: at,
      }));
      const { error } = await supabase.from(DAY_OVERRIDE_TABLE).upsert(rows, { onConflict: "team_id,rider_id,override_date" });
      if (error) throw new Error(error.message);
      res.json({
        ok: true, date: parsed.date, session: parsed.session, riderIds: target.ids,
        beatsRuleRiderIds: rows.filter((row) => row.beats_fatigue_rule).map((row) => row.rider_id),
      });
    } catch (err) {
      captureExceptionFn(err);
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE body { riderIds?: string[], groupId?: string, date } ("Tilbage til planen", DO-6)
  router.delete("/", requireAuth, writeLimiter, async (req, res) => {
    if (!req.team) return res.status(400).json({ error: "No team found" });
    try {
      if (!(await enabled(req))) return res.status(409).json({ error: "feature_disabled" });
      const now = today();
      const parsed = parseOverrideWrite(req.body, { today: now, needSession: false });
      if (!parsed.ok) return res.status(parsed.status).json({ error: parsed.reason });
      const target = await targets(req, parsed);
      if (!target.ok) return res.status(target.status).json({ error: target.reason });
      const { error } = await supabase.from(DAY_OVERRIDE_TABLE).delete()
        .eq("team_id", req.team.id).eq("override_date", parsed.date).in("rider_id", target.ids);
      if (error) throw new Error(error.message);
      await deleteExpiredOverrides({ supabase, teamId: req.team.id, today: now });
      res.json({ ok: true, date: parsed.date, riderIds: target.ids });
    } catch (err) {
      captureExceptionFn(err);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
