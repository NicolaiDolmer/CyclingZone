// #5928 / #5912: recompute ONE legacy (5x) training date with the normalized
// per-date model, from that date's own training reports. READ-ONLY.
// Output contains private rider data: write it OUTSIDE the repo.
// Usage (repo root): infisical run --env=prod -- node backend/scripts/dev/trainingConditionYesterdayCorrection.mjs <legacy-date> <out.private.json>
//
// Evidence per rider (all from the date's per-slot reports, no guessing):
// - Opening fatigue is 0: the season-start reset (mode "full") ran the evening
//   before the first S4 date. Only valid for that first date.
// - The date's legacy race load L = pre-fatigue of the first slot (fatigue - fatigue_delta).
// - Slots must chain: each slot's pre-fatigue equals the previous slot's fatigue.
// - Opening form is inverted exactly from slot 1 (nextForm's delta depends only on
//   the new fatigue); a clamp at 0/100 makes it ambiguous and the rider is skipped.
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { DAILY_TRAINING_CONFIG } from "../../lib/dailyTraining.js";
import { CONDITION_CONFIG, nextFatigue, nextForm, RACE_DAY_ENGINE_RECOVERY_CONFIG } from "../../lib/riderCondition.js";

export function formDeltaFor(fatigue) {
  const c = CONDITION_CONFIG;
  if (fatigue >= c.formSweetLo && fatigue <= c.formSweetHi) return c.formGain;
  if (fatigue > 80) return -c.formOverloadLoss;
  if (fatigue > c.formSweetHi) return -c.formHighLoss;
  return c.formMildGain;
}

/** slots: the rider's 5 report rows for the date. Returns {ok, ...} or {ok:false, reason}. */
export function recomputeLegacyDate({ slots, recoveryAbility }) {
  if (!Array.isArray(slots) || slots.length !== 5) return { ok: false, reason: "not_five_slots" };
  const s = [...slots].sort((a, b) => a.game_day - b.game_day);
  if (new Set(s.map((x) => x.game_day)).size !== 5) return { ok: false, reason: "duplicate_game_day" };
  for (const x of s) {
    if (![x.fatigue, x.fatigue_delta, x.form].every(Number.isFinite) || typeof x.intensity !== "string") {
      return { ok: false, reason: "incomplete_report" };
    }
  }
  const pre = s.map((x) => x.fatigue - x.fatigue_delta);
  for (let k = 1; k < 5; k++) if (pre[k] !== s[k - 1].fatigue) return { ok: false, reason: "slots_do_not_chain" };
  const raceLoad = pre[0];
  if (!Number.isInteger(raceLoad) || raceLoad < 0 || raceLoad >= 100) return { ok: false, reason: "race_load_unprovable" };
  if (s[0].form <= 0 || s[0].form >= 100) return { ok: false, reason: "form_clamped" };
  const openingForm = s[0].form - formDeltaFor(s[0].fatigue);
  const trainingLoad = s.reduce((sum, x) => sum + (DAILY_TRAINING_CONFIG.fatigueLoad[x.intensity] ?? 0), 0);
  const meanLoad = (trainingLoad + raceLoad) / 5;
  const fatigue = nextFatigue({ fatigue: 0, intensity: "race", raceLoad: meanLoad,
    recoveryAbility: Number.isFinite(recoveryAbility) ? recoveryAbility : 50, ...RACE_DAY_ENGINE_RECOVERY_CONFIG });
  const form = nextForm({ form: openingForm, fatigue });
  return { ok: true, fatigue, form, openingForm, raceLoad, legacyFatigue: s[4].fatigue, legacyForm: s[4].form };
}

async function main() {
  const [date, outPath] = process.argv.slice(2);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? "") || !outPath) throw new Error("Usage: <legacy-date> <out.private.json>");
  const { createClient } = await import("@supabase/supabase-js");
  const { fetchAllRows, fetchAllRowsChunkedIn } = await import("../../lib/supabasePagination.js");
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const runs = await fetchAllRows(() => sb.from("training_day_runs").select("id,team_id,game_day,report").eq("tick_date", date).order("id"));
  const byRider = new Map();
  for (const run of runs) {
    if (!Number.isInteger(run.game_day)) continue;
    for (const rr of run.report?.riders ?? []) {
      if (!byRider.has(rr.rider_id)) byRider.set(rr.rider_id, []);
      byRider.get(rr.rider_id).push({ game_day: run.game_day, run_id: run.id, fatigue: Number(rr.fatigue),
        fatigue_delta: Number(rr.fatigue_delta), form: Number(rr.form), intensity: rr.intensity });
    }
  }
  const ids = [...byRider.keys()];
  const abilities = await fetchAllRowsChunkedIn(ids, (chunk) => sb.from("rider_derived_abilities").select("rider_id,recovery").in("rider_id", chunk).order("rider_id"));
  const recovery = new Map(abilities.map((a) => [a.rider_id, Number(a.recovery)]));
  const corrections = {}, skipped = {};
  for (const [id, slots] of byRider) {
    const r = recomputeLegacyDate({ slots, recoveryAbility: recovery.get(id) });
    if (r.ok) corrections[id] = { ...r, source: `recompute-${date}:${slots.map((x) => x.run_id).sort().join(",").slice(0, 80)}` };
    else skipped[r.reason] = (skipped[r.reason] ?? 0) + 1;
  }
  fs.writeFileSync(outPath, JSON.stringify({ date, computed_at: new Date().toISOString(), corrections }, null, 2));
  const vals = Object.values(corrections);
  const avg = (f) => Math.round(vals.reduce((t, v) => t + f(v), 0) / Math.max(1, vals.length) * 10) / 10;
  console.log(JSON.stringify({ date, riders: byRider.size, corrected: vals.length, skipped,
    avg_legacy_fatigue: avg((v) => v.legacyFatigue), avg_corrected_fatigue: avg((v) => v.fatigue),
    avg_legacy_form: avg((v) => v.legacyForm), avg_corrected_form: avg((v) => v.form),
    legacy_ge70: vals.filter((v) => v.legacyFatigue >= 70).length, corrected_ge70: vals.filter((v) => v.fatigue >= 70).length }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
