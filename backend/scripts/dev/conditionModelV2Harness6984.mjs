#!/usr/bin/env node
// #6984 · HARNESS: Form og træthed 2.0 (condition_model_v2) mod den rigtige S4-sæson.
//
// 100 % READ-ONLY. Scriptet SELECT'er mod prod og skriver kun lokale filer. Ingen
// klient i denne fil kan skrive; intet flag røres.
//
// Metode (åben sløjfe): hver rytters faktiske S4-dato-forløb (de fem pladsers
// intensitet, registrerede etaper med profil/distance, recovery-evne) afspilles to
// gange fra rytterens første afregnede åbning:
//   V1  produktionens nuværende afregning (settleTrainingDateCondition, flag off)
//   V2  condition_model_v2 (samme funktion med modelV2: true; etapens v2-belastning
//       fra stageLoadV2 × rytterens målte indsats/arbejds-forhold fra ledgeren)
// Begrænsning: managernes valg er frosne (ingen reaktion på den nye træthed), og B2
// (ophobning inde i løbet) påvirker resultater, ikke afregningen, så den er ikke med.
//
// Kør fra backend/:
//   infisical run --env=prod --silent -- node scripts/dev/conditionModelV2Harness6984.mjs <season_id> <out-dir>
// <out-dir> SKAL være balance-internals/6984 (gitignoreret, hard rule 17).

import "dotenv/config";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { settleTrainingDateCondition } from "../../lib/trainingDateCondition.js";
import { stageLoadV2, settleTrainingDateConditionV2, CONDITION_V2_CONFIG } from "../../lib/conditionModelV2.js";
import { raceFatigueLoad, stageRaceConditionLoad } from "../../lib/raceFatigue.js";
import { isS5ProfilesV1OrLater } from "../../lib/raceEngineRulesRevision.ts";
import { RACE_DAY_ENGINE_RECOVERY_CONFIG } from "../../lib/riderCondition.js";
import { fetchAllRows, fetchAllRowsChunkedIn } from "../../lib/supabasePagination.js";

// ── Ren kerne ──────────────────────────────────────────────────────────────────

/** v1's "normale" belastning for etapen (uden indsats/arbejde), til at aflæse forholdet. */
export function v1NormalLoad({ profileType, stageNumber, rulesRevision }) {
  return isS5ProfilesV1OrLater(rulesRevision)
    ? stageRaceConditionLoad({ profileType, stageNumber, rulesRevision })
    : raceFatigueLoad(profileType);
}

/**
 * Afspil én rytters dato-forløb. `dates` = [{ tickDate, slots: [{intensity, stage?}] ×5, recovery }]
 * hvor stage = { recordedLoad, profileType, distanceKm, stageNumber, rulesRevision }.
 * Returnerer pr. dato { tickDate, v1: {fatigue, form, risk}, v2: {...} }.
 */
export function replayRider({ riderId, opening, dates, cfg = CONDITION_V2_CONFIG }) {
  let s1 = { fatigue: Number(opening?.fatigue ?? 0), form: Number(opening?.form ?? 50) };
  let s2 = { ...s1 };
  let seasonDays = 0;
  const out = [];
  for (const date of dates) {
    if (!Array.isArray(date.slots) || date.slots.length !== 5) continue;
    const intensities = date.slots.map((slot) => slot.intensity);
    const v1Loads = date.slots.map((slot) => (slot.intensity === "race" ? Number(slot.stage?.recordedLoad ?? 0) : 0));
    const v2Loads = date.slots.map((slot) => {
      if (slot.intensity !== "race" || !slot.stage) return 0;
      seasonDays++;
      const st = slot.stage;
      const normal = v1NormalLoad(st);
      const ratio = normal > 0 ? Math.max(0.3, Math.min(2, Number(st.recordedLoad ?? normal) / normal)) : 1;
      return stageLoadV2({ profileType: st.profileType, distanceKm: st.distanceKm, stageNumber: st.stageNumber, seasonRaceDays: seasonDays, rulesRevision: st.rulesRevision, cfg }) * ratio;
    });
    const args = { riderId, dateStr: date.tickDate, intensities, recoveryAbility: date.recovery ?? 50, recoveryConfig: RACE_DAY_ENGINE_RECOVERY_CONFIG };
    const r1 = settleTrainingDateCondition({ ...args, condition: s1, raceLoads: v1Loads });
    // Samme funktion som settleTrainingDateCondition({ modelV2: true }) delegerer til, med cfg til kalibrering.
    const r2 = settleTrainingDateConditionV2({ riderId, dateStr: date.tickDate, intensities, recoveryAbility: date.recovery ?? 50, condition: s2, raceLoads: v2Loads, cfg });
    s1 = { fatigue: r1.fatigue, form: r1.form };
    s2 = { fatigue: r2.fatigue, form: r2.form };
    out.push({ tickDate: date.tickDate, v1: { ...s1, risk: r1.risk }, v2: { ...s2, risk: r2.risk }, raced: v2Loads.some((l) => l > 0) });
  }
  return out;
}

const median = (xs) => { if (!xs.length) return null; const a = xs.slice().sort((x, y) => x - y); const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
const pct = (xs, pred) => (xs.length ? Math.round(1000 * xs.filter(pred).length / xs.length) / 10 : null);

/** Gates fra spec §7 på hele populationen. `riders` = [{ riderId, ai, trace }]. */
export function summarize({ riders, grandTours = [] }) {
  const byDate = new Map();
  for (const r of riders) for (const d of r.trace) {
    if (!byDate.has(d.tickDate)) byDate.set(d.tickDate, { human: [], ai: [] });
    byDate.get(d.tickDate)[r.ai ? "ai" : "human"].push(d);
  }
  const perDate = [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([tickDate, g]) => {
    const row = { tickDate };
    for (const owner of ["human", "ai"]) for (const m of ["v1", "v2"]) {
      const xs = g[owner].map((d) => d[m]);
      row[`${owner}_${m}`] = {
        n: xs.length,
        medianFatigue: median(xs.map((x) => x.fatigue)),
        pct70: pct(xs, (x) => x.fatigue >= 70),
        pctForm98: pct(xs, (x) => x.form >= 98),
        medianForm: median(xs.map((x) => x.form)),
        injuriesPer1000: xs.length ? Math.round(1000 * xs.reduce((s, x) => s + x.risk, 0) / xs.length * 100) / 100 : null,
      };
    }
    return row;
  });
  const gts = grandTours.map((gt) => {
    const res = { name: gt.name };
    for (const m of ["v1", "v2"]) {
      const rows = riders.filter((r) => gt.riderIds.has(r.riderId)).map((r) => {
        const inGt = r.trace.filter((d) => d.tickDate >= gt.first && d.tickDate <= gt.last);
        if (!inGt.length) return null;
        return { peak: Math.max(...inGt.map((d) => d[m].fatigue)), end: inGt[inGt.length - 1][m].fatigue, form: inGt[inGt.length - 1][m].form, ai: r.ai };
      }).filter(Boolean);
      for (const owner of ["human", "ai"]) {
        const xs = rows.filter((x) => x.ai === (owner === "ai"));
        res[`${owner}_${m}`] = { n: xs.length, medianPeak: median(xs.map((x) => x.peak)), medianEnd: median(xs.map((x) => x.end)), pctPeak70: pct(xs, (x) => x.peak >= 70), pctPeak90: pct(xs, (x) => x.peak >= 90), medianFormEnd: median(xs.map((x) => x.form)), pctForm98End: pct(xs, (x) => x.form >= 98) };
      }
    }
    return res;
  });
  return { perDate, grandTours: gts };
}

// ── I/O (kun SELECT) ───────────────────────────────────────────────────────────

async function exportSeason(sb, seasonId) {
  const settlements = await fetchAllRows(() => sb.from("training_condition_settlements")
    .select("rider_id, tick_date, team_id, opening_condition").eq("season_id", seasonId).eq("status", "complete")
    .order("rider_id").order("tick_date"));
  const firstByRider = new Map();
  for (const s of settlements) if (!firstByRider.has(s.rider_id)) firstByRider.set(s.rider_id, s);
  const riderIds = [...firstByRider.keys()];
  const teamIds = [...new Set(settlements.map((s) => s.team_id).filter(Boolean))];
  const teams = await fetchAllRowsChunkedIn(teamIds, (ids) => sb.from("teams").select("id, is_ai").in("id", ids).order("id"));
  const aiTeam = new Set(teams.filter((t) => t.is_ai).map((t) => t.id));
  const ticks = await fetchAllRowsChunkedIn(riderIds, (ids) => sb.from("training_rider_ticks")
    .select("rider_id, game_day, tick_date, intensity:report->>intensity, recovery:report->>recovery_before_date")
    .eq("season_id", seasonId).in("rider_id", ids).order("rider_id").order("game_day"));
  const loads = await fetchAllRowsChunkedIn(riderIds, (ids) => sb.from("training_race_loads")
    .select("rider_id, race_id, stage_number, game_day, load").eq("season_id", seasonId).is("duplicate_of_race_id", null)
    .in("rider_id", ids).order("rider_id").order("game_day").order("race_id"));
  const raceIds = [...new Set(loads.map((l) => l.race_id))];
  const races = await fetchAllRowsChunkedIn(raceIds, (ids) => sb.from("races").select("id, name, race_class, stages, engine_rules_revision").in("id", ids).order("id"));
  const profiles = await fetchAllRowsChunkedIn(raceIds, (ids) => sb.from("race_stage_profiles").select("race_id, stage_number, profile_type, distance_km").in("race_id", ids).order("race_id").order("stage_number"));
  return { settlements: [...firstByRider.values()], aiTeam, ticks, loads, races, profiles };
}

function buildRiders({ settlements, aiTeam, ticks, loads, races, profiles }) {
  const raceById = new Map(races.map((r) => [r.id, r]));
  const profileKey = (raceId, stage) => `${raceId}:${stage}`;
  const profileBy = new Map(profiles.map((p) => [profileKey(p.race_id, p.stage_number), p]));
  const loadBy = new Map(loads.map((l) => [`${l.rider_id}:${l.game_day}`, l]));
  const ticksByRider = new Map();
  for (const t of ticks) { if (!ticksByRider.has(t.rider_id)) ticksByRider.set(t.rider_id, []); ticksByRider.get(t.rider_id).push(t); }
  return settlements.map((s) => {
    const byDate = new Map();
    for (const t of ticksByRider.get(s.rider_id) ?? []) {
      if (t.tick_date < s.tick_date) continue;
      if (!byDate.has(t.tick_date)) byDate.set(t.tick_date, []);
      byDate.get(t.tick_date).push(t);
    }
    const dates = [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([tickDate, rows]) => {
      rows.sort((a, b) => a.game_day - b.game_day);
      return {
        tickDate,
        recovery: Number(rows.find((r) => r.recovery != null)?.recovery ?? 50),
        slots: rows.map((r) => {
          const load = loadBy.get(`${s.rider_id}:${r.game_day}`);
          if (!load) return { intensity: r.intensity === "race" ? "rest" : r.intensity };
          const race = raceById.get(load.race_id);
          const p = profileBy.get(profileKey(load.race_id, load.stage_number));
          return { intensity: "race", stage: { recordedLoad: Number(load.load), profileType: p?.profile_type ?? "rolling", distanceKm: p?.distance_km ?? null, stageNumber: load.stage_number, rulesRevision: race?.engine_rules_revision ?? null } };
        }),
      };
    });
    return { riderId: s.rider_id, ai: aiTeam.has(s.team_id), opening: s.opening_condition, dates };
  });
}

function grandToursFrom({ loads, races }) {
  const gts = races.filter((r) => Number(r.stages) >= 15);
  return gts.map((gt) => {
    const rows = loads.filter((l) => l.race_id === gt.id);
    return { name: gt.name, riderIds: new Set(rows.map((l) => l.rider_id)), raceId: gt.id };
  });
}

async function main() {
  const argv = process.argv.slice(2);
  const flag = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
  const [seasonId, outDirArg] = argv.filter((a, i) => !a.startsWith("--") && !(i > 0 && argv[i - 1].startsWith("--")));
  const cfg = flag("--cfg") ? { ...CONDITION_V2_CONFIG, ...JSON.parse(readFileSync(flag("--cfg"), "utf8")) } : CONDITION_V2_CONFIG;
  const label = flag("--label") ?? "base";
  if (!seasonId || !outDirArg) { console.error("Brug: <season_id> <out-dir under balance-internals/>"); process.exit(2); }
  const outDir = resolve(outDirArg);
  if (!/balance-internals/.test(outDir)) { console.error("out-dir skal ligge under balance-internals/ (hard rule 17)"); process.exit(2); }
  const fixturePath = join(outDir, `fixture-${seasonId.slice(-4)}.json`);
  let built, data;
  if (flag("--from-fixture")) {
    ({ built, grandTourDates: data } = JSON.parse(readFileSync(fixturePath, "utf8")));
    data.grandTours = data.grandTours.map((gt) => ({ ...gt, riderIds: new Set(gt.riderIds) }));
  } else {
    const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) { console.error("SUPABASE_URL / SUPABASE_SERVICE_KEY mangler (kør via infisical run --env=prod)"); process.exit(2); }
    const { createClient } = await import("@supabase/supabase-js");
    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    console.log("Henter S4 (kun SELECT) ...");
    const raw = await exportSeason(sb, seasonId);
    console.log(`ryttere ${raw.settlements.length} · ticks ${raw.ticks.length} · etaper ${raw.loads.length}`);
    built = buildRiders(raw);
    const tickOfRiderDay = new Map(raw.ticks.map((t) => [`${t.rider_id}:${t.game_day}`, t.tick_date]));
    const grandTours = grandToursFrom(raw).map((gt) => {
      const dates = raw.loads.filter((l) => l.race_id === gt.raceId).map((l) => tickOfRiderDay.get(`${l.rider_id}:${l.game_day}`)).filter(Boolean).sort();
      return { ...gt, first: dates[0], last: dates[dates.length - 1] };
    });
    data = { grandTours };
    mkdirSync(outDir, { recursive: true });
    writeFileSync(fixturePath, JSON.stringify({ built, grandTourDates: { grandTours: grandTours.map((gt) => ({ ...gt, riderIds: [...gt.riderIds] })) } }));
  }
  const riders = built.map((r) => ({ riderId: r.riderId, ai: r.ai, trace: replayRider({ ...r, cfg }) }));
  const summary = summarize({ riders, grandTours: data.grandTours });
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const outFile = join(outDir, `harness-${stamp}-${label}.json`);
  writeFileSync(outFile, JSON.stringify({ seasonId, label, cfg, riders: riders.length, ...summary }, null, 1));
  console.log(`Skrevet: ${outFile}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
