// #4854 + #5620 · /api/training/fatigue-rules — spillerens egne traeningsregler.
//
// Samme fabrik-moenster som routes/trainingPrograms.js: egen fil, fake Supabase i
// testen, monteret i api.js FOER `/training/:riderId`.
//
// Gate: stadie-flaget `training_fatigue_rules` evalueret mod VIEWERENS beta-status.
// Flag off/ikke-beta → GET svarer { enabled: false }, skrivestierne 404.
//
//   GET  /                 → regler, truppen (med traethed nu) og de seneste 7
//                            datoers stempler (dage hvor en regel slog til).
//   PUT  /team             → holdreglen { threshold, fallback, recoveryAfterStage }.
//                            Ingen graense og ingen etape-regel = raekken slettes.
//   PUT  /riders/:riderId  → undtagelsen { mode: "team" | "own" | "off", threshold?, fallback? }.
//                            "team" = raekken slettes (foelg holdet).

import express from "express";
import {
  isTrainingFatigueRulesEnabled, isFatigueFallback, isValidThreshold, isMissingRulesTable, loadFatigueRuleRows,
} from "../lib/trainingFatigueRules.ts";
import { copenhagenDateString } from "../lib/copenhagenTime.js";

const PASS = (_req, _res, next) => next();
export const RECENT_DAYS = 7;

function dateMinusDays(dateStr, days) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function ruleView(row) {
  if (!row) return null;
  return {
    threshold: row.fatigue_threshold ?? null,
    fallback: row.fallback ?? null,
    recoveryAfterStage: typeof row.recovery_after_stage === "boolean" ? row.recovery_after_stage : null,
  };
}

export function createTrainingFatigueRulesRouter({
  supabase, requireAuth, isViewerBetaTester, writeLimiter = PASS, readLimiter = PASS,
  captureExceptionFn = () => {}, now = () => new Date(),
}) {
  const router = express.Router();

  async function enabled(req) {
    return isTrainingFatigueRulesEnabled(supabase, { isBetaTester: await isViewerBetaTester(req) });
  }

  async function loadRows(teamId) {
    const { data, error } = await loadFatigueRuleRows(supabase, teamId);
    if (error && !isMissingRulesTable(error)) throw new Error(error.message);
    if (error) return { rows: [], missingTable: true };
    return { rows: data ?? [], missingTable: false };
  }

  async function findRow(teamId, riderId) {
    let query = supabase.from("team_training_rules").select("id").eq("team_id", teamId);
    query = riderId == null ? query.is("rider_id", null) : query.eq("rider_id", riderId);
    const { data, error } = await query.limit(1);
    if (error) throw new Error(error.message);
    return data?.[0]?.id ?? null;
  }

  // PostgREST kan ikke upserte paa et partielt unikt index; find + update/insert.
  async function writeRow(teamId, riderId, patch) {
    const id = await findRow(teamId, riderId);
    const updated_at = now().toISOString();
    const update = (rowId) => supabase.from("team_training_rules").update({ ...patch, updated_at }).eq("id", rowId);
    let result = id
      ? await update(id)
      : await supabase.from("team_training_rules").insert({ team_id: teamId, rider_id: riderId, ...patch, updated_at });
    // Dobbeltklik / to faner: den anden INSERT rammer det partielle unikke index
    // (23505). Raekken findes nu, saa skrivningen goeres faerdig som en update.
    if (!id && result.error?.code === "23505") {
      const existing = await findRow(teamId, riderId);
      if (existing) result = await update(existing);
    }
    if (result.error) throw new Error(result.error.message);
  }

  async function deleteRow(teamId, riderId) {
    let query = supabase.from("team_training_rules").delete().eq("team_id", teamId);
    query = riderId == null ? query.is("rider_id", null) : query.eq("rider_id", riderId);
    const { error } = await query;
    if (error) throw new Error(error.message);
  }

  router.get("/", requireAuth, readLimiter, async (req, res) => {
    if (!req.team) return res.status(400).json({ error: "No team found" });
    try {
      if (!(await enabled(req))) return res.json({ enabled: false });
      const teamId = req.team.id;
      const { rows } = await loadRows(teamId);
      const { data: riders, error: ridersError } = await supabase
        // pagination-safe: one team roster, far below the 1000-row cap.
        .from("riders").select("id, firstname, lastname").eq("team_id", teamId).eq("is_retired", false);
      if (ridersError) throw new Error(ridersError.message);
      const riderIds = (riders ?? []).map((r) => r.id);
      const { data: conditions, error: condError } = riderIds.length
        ? await supabase.from("rider_condition").select("rider_id, fatigue").in("rider_id", riderIds)
        : { data: [], error: null };
      if (condError) throw new Error(condError.message);
      const fatigueBy = new Map((conditions ?? []).map((c) => [c.rider_id, Number(c.fatigue ?? 0)]));

      const today = copenhagenDateString(now());
      const since = dateMinusDays(today, RECENT_DAYS - 1);
      // Kun raekker hvor en regel slog til; ét holds ryttere over 7 datoer.
      const { data: ticks, error: ticksError } = await supabase.from("training_rider_ticks")
        .select("rider_id, tick_date, game_day, fatigue_rule:report->fatigue_rule")
        .eq("team_id", teamId).gte("tick_date", since)
        .not("report->fatigue_rule", "is", null)
        .order("tick_date", { ascending: true }).limit(1000);
      if (ticksError) throw new Error(ticksError.message);

      const team = rows.find((r) => r.rider_id == null) ?? null;
      const riderRules = {};
      for (const row of rows) if (row.rider_id != null) riderRules[row.rider_id] = ruleView(row);
      res.json({
        enabled: true,
        today,
        days: Array.from({ length: RECENT_DAYS }, (_, i) => dateMinusDays(today, RECENT_DAYS - 1 - i)),
        team: ruleView(team),
        riders: riderRules,
        roster: (riders ?? []).map((r) => ({
          id: r.id, name: `${r.firstname ?? ""} ${r.lastname ?? ""}`.trim(), fatigue: fatigueBy.get(r.id) ?? 0,
        })),
        recent: (ticks ?? []).filter((t) => t.fatigue_rule && typeof t.fatigue_rule === "object").map((t) => ({
          date: t.tick_date,
          gameDay: t.game_day,
          riderId: t.rider_id,
          kind: t.fatigue_rule.kind,
          fallback: t.fatigue_rule.fallback,
          fatigue: t.fatigue_rule.fatigue,
          threshold: t.fatigue_rule.threshold ?? null,
        })),
      });
    } catch (err) {
      captureExceptionFn(err);
      res.status(500).json({ error: err.message });
    }
  });

  router.put("/team", requireAuth, writeLimiter, async (req, res) => {
    if (!req.team) return res.status(400).json({ error: "No team found" });
    const { threshold = null, fallback = null, recoveryAfterStage = false } = req.body ?? {};
    const hasLimit = threshold != null || fallback != null;
    if (hasLimit && !(isValidThreshold(threshold) && isFatigueFallback(fallback))) {
      return res.status(400).json({ error: "invalid_rule" });
    }
    if (typeof recoveryAfterStage !== "boolean") return res.status(400).json({ error: "invalid_rule" });
    try {
      if (!(await enabled(req))) return res.status(404).json({ error: "not_found" });
      const teamId = req.team.id;
      if (!hasLimit && !recoveryAfterStage) await deleteRow(teamId, null);
      else {
        await writeRow(teamId, null, {
          fatigue_threshold: hasLimit ? threshold : null,
          fallback: hasLimit ? fallback : null,
          recovery_after_stage: recoveryAfterStage,
        });
      }
      res.json({ ok: true });
    } catch (err) {
      captureExceptionFn(err);
      res.status(500).json({ error: err.message });
    }
  });

  router.put("/riders/:riderId", requireAuth, writeLimiter, async (req, res) => {
    if (!req.team) return res.status(400).json({ error: "No team found" });
    const { riderId } = req.params;
    const { mode, threshold = null, fallback = null } = req.body ?? {};
    if (!["team", "own", "off"].includes(mode)) return res.status(400).json({ error: "invalid_rule" });
    if (mode === "own" && !(isValidThreshold(threshold) && isFatigueFallback(fallback))) {
      return res.status(400).json({ error: "invalid_rule" });
    }
    try {
      if (!(await enabled(req))) return res.status(404).json({ error: "not_found" });
      const teamId = req.team.id;
      const { data: rider, error: riderError } = await supabase
        .from("riders").select("id, team_id").eq("id", riderId).maybeSingle();
      if (riderError) throw new Error(riderError.message);
      if (!rider || rider.team_id !== teamId) return res.status(403).json({ error: "not_own_rider" });
      if (mode === "team") await deleteRow(teamId, riderId);
      else {
        await writeRow(teamId, riderId, {
          fatigue_threshold: mode === "own" ? threshold : null,
          fallback: mode === "own" ? fallback : "off",
          recovery_after_stage: null,
        });
      }
      res.json({ ok: true });
    } catch (err) {
      captureExceptionFn(err);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
