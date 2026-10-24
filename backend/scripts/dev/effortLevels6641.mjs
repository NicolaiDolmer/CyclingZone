#!/usr/bin/env node
// backend/scripts/dev/effortLevels6641.mjs
// #6641 (ejer 15/10: maalt baseline FOER kalibreringen): hvad koster og koeber hvert af
// de fem indsatstrin (grupetto/save/normal/protect/all_out) over et HELT etapeloeb, i
// loebet OG i traetheden bagefter, under begge tilstandsmodeller.
//
// METODE (femarmede tvillinger). For hvert etapeloeb klones tre skabelon-ryttere fra
// feltet (midt, staerk, top paa en klassementsevne) til fem identiske kopier, én pr.
// trin. Kopierne koerer hele loebet paa deres trin, hver paa sit eget hold uden andre
// ryttere (ingen hold-effekter), i det anonymiserede bench-felt (alle andre hold er AI).
// Forskellen mellem en kopi og sin normal-tvilling er trinnets pris/gevinst. Rider-id'et
// indgaar i motorens rng, saa resultatet midles over motor-seeds.
//
// TILSTANDSMODELLER (traetheden rytteren koerer naeste etape med):
//   date    prod i dag (training_condition_per_date): traetheden laeses ved datoens start
//           og afregnes EEN gang ved datoens slutning med de 5 loebsdages belastning
//           (trainingDateCondition.settleTrainingDateCondition).
//   v2      condition_model_v2 (#6984): hver etape vejer et doegn, i raekkefoelge
//           (enteringFatigueV2 inden for datoen, settle med modelV2 ved datoens slutning).
//   legacy  loebets egen akkumulering uden restitution (raceFatigue.stageEnteringFatigues,
//           trainingOwnsRecovery=false): modellen hvor startgaettet 6/9 ramte loftet.
// Frie pladser paa en dato traenes "normal" for alle.
//
// HARD RULE 17: maalte tal skrives KUN til balance-internals/ (gitignoreret).
// 100% offline: ingen DB, ingen prod.
//
// Koer:
//   node backend/scripts/dev/effortLevels6641.mjs --out=balance-internals/6641 [--label=baseline]
//     [--sim-seeds=2] [--gen-seeds=1] [--max-races=12] [--revision=s5_profiles_v2]
// Kandidat-traethed (raceRoles' env-knapper) koeres med RACE_INTENTION_FATIGUE_* i env.
//
// Refs #6641 #6940 #4914

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { buildS5BenchRaces, loadBenchField } from "./s5MotorBench.mjs";
import { stageDateIndex } from "./gtFatigueBench.mjs";
import { runStagesInOrder, sortedStages, splitEntrants } from "./lib/tourScorecard.mjs";
import { loadRaceEngineV4, breakawayRiderIdsFromSnapshots } from "../../lib/raceEngineV4Bridge.js";
import { raceConditionLoads, stageConditionWork, stageEnteringFatigues } from "../../lib/raceFatigue.js";
import { settleTrainingDateCondition } from "../../lib/trainingDateCondition.js";
import { enteringFatigueV2 } from "../../lib/conditionModelV2.js";
import { effortFatigueMultiplier, effortDevelopmentMultiplier } from "../../lib/raceRoles.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, "..", "..", "..");
const SLOTS = 5;

export const EFFORTS = Object.freeze(["grupetto", "save", "normal", "protect", "all_out"]);
export const LEVELS = Object.freeze({ mid: 0.5, strong: 0.9, top: 0.99 });
export const MODELS = Object.freeze(["date", "v2", "legacy"]);
const MOUNTAIN = new Set(["mountain", "high_mountain", "medium_mountain"]);
const FLAT = new Set(["flat", "rolling"]);
const TT = new Set(["itt", "itt_hilly", "ttt"]);
export const EFFORT_6641_CONFIG = Object.freeze({ startFatigue: 15, seasonRaceDays: 25, training: "normal" });

const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
const r1 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10) / 10);

/** Etapeloebets klasse ud fra etapeprofilerne (ren). */
export function raceClass(stages) {
  const road = stages.filter((s) => !TT.has(s.profile_type));
  if (!road.length) return "tt";
  const m = road.filter((s) => MOUNTAIN.has(s.profile_type)).length / road.length;
  const f = road.filter((s) => FLAT.has(s.profile_type)).length / road.length;
  if (m >= 0.5) return "mountain";
  if (f >= 0.6) return "flat";
  return "mixed";
}

/** Terraen-klasse for én etape (til pris pr. etapetype). */
export function stageClass(profileType) {
  if (TT.has(profileType)) return "tt";
  if (profileType === "high_mountain" || profileType === "mountain") return "mountain";
  if (profileType === "medium_mountain" || profileType === "hilly" || profileType === "classic" || profileType === "cobbles" || profileType === "gravel") return "hilly";
  return "flat";
}

const strengthOf = (a) => (Number(a.climbing) || 0) + (Number(a.durability) || 0) + (Number(a.punch) || 0);

/** Skabelon-ryttere ved percentilerne i LEVELS (ren). */
export function pickTemplates(abilities) {
  const sorted = abilities.slice().sort((x, y) => strengthOf(x) - strengthOf(y) || String(x.rider_id).localeCompare(String(y.rider_id)));
  const out = {};
  for (const [level, p] of Object.entries(LEVELS)) out[level] = sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))];
  return out;
}

export const twinId = (level, effort) => `twin6641-${level}-${effort}`;

/** Feltet + 15 tvillinger (ren). */
export function withTwins(field, templates) {
  const entries = [...field.entries];
  const abilities = [...field.abilities];
  const teams = [...field.teams];
  for (const [level, tpl] of Object.entries(templates)) {
    const { rider_id: _r, ...ab } = tpl;
    for (const effort of EFFORTS) {
      const id = twinId(level, effort);
      const teamId = `team-${id}`;
      entries.push({ rider_id: id, team_id: teamId, race_role: "free_role" });
      abilities.push({ rider_id: id, ...ab });
      teams.push({ id: teamId, is_ai: false });
    }
  }
  return { ...field, entries, abilities, teams };
}

function runRace({ v4, field, race, stages, seasonId, simSeed, revision, model, templates, fatigueRevision = null }) {
  const raceId = `${race.id}:${seasonId}`;
  const profiles = stages.map((p) => ({ ...p, race_id: raceId }));
  const twinField = withTwins(field, templates);
  const data = { ...twinField, race: { ...twinField.race, id: raceId, stages: profiles.length }, profiles };
  const sorted = sortedStages(data);
  const dateIdx = stageDateIndex(sorted);
  const entrants = splitEntrants(data).entrants;
  const twinIds = new Set();
  for (const e of entrants) {
    const m = /^twin6641-(\w+)-(\w+)$/.exec(e.rider_id);
    if (m) { e.effort = m[2]; twinIds.add(e.rider_id); }
  }
  const recovery = new Map(twinField.abilities.map((a) => [a.rider_id, Number(a.recovery) || 50]));
  const effortOf = (id) => entrants.find((e) => e.rider_id === id)?.effort ?? "normal";
  const cond = new Map(entrants.map((e) => [e.rider_id, { fatigue: EFFORT_6641_CONFIG.startFatigue, form: 50 }]));
  const loadsToday = new Map();
  // legacy: hele sekvensen er en ren funktion af profilerne og trinnet.
  const legacySeq = new Map(entrants.map((e) => [e.rider_id, stageEnteringFatigues(EFFORT_6641_CONFIG.startFatigue, sorted.map((s) => s.profile_type), { effort: e.effort, rulesRevision: revision })]));
  const perStage = [];
  let currentDate = dateIdx[0];
  const enter = (index) => {
    for (const e of entrants) {
      if (model === "legacy") e.fatigue = legacySeq.get(e.rider_id)[index];
      else if (model === "v2") e.fatigue = enteringFatigueV2({ openingFatigue: cond.get(e.rider_id).fatigue, priorLoadsToday: loadsToday.get(e.rider_id) ?? [], recoveryAbility: recovery.get(e.rider_id) });
      else e.fatigue = cond.get(e.rider_id).fatigue;
    }
  };
  const settle = (ids) => {
    for (const id of ids) {
      const raceLoads = loadsToday.get(id) ?? [];
      const intensities = Array.from({ length: SLOTS }, (_, i) => (i < raceLoads.length ? "race" : EFFORT_6641_CONFIG.training));
      const rl = Array.from({ length: SLOTS }, (_, i) => raceLoads[i] ?? 0);
      const res = settleTrainingDateCondition({ riderId: id, dateStr: `${seasonId}-${currentDate}`, condition: cond.get(id), intensities, raceLoads: rl, recoveryAbility: recovery.get(id), modelV2: model === "v2" });
      cond.set(id, { fatigue: res.fatigue, form: res.form });
    }
    loadsToday.clear();
  };
  enter(0);
  const enteringByStage = [];
  runStagesInOrder({
    v4, data, revision, seedTag: `e6641-${simSeed}`, stages: sorted, entrants,
    onStage: ({ profile, index, res, entrants: started, gcAfter }) => {
      enteringByStage.push(new Map(started.map((e) => [e.rider_id, e.fatigue])));
      const ids = started.map((e) => e.rider_id);
      const work = stageConditionWork({ rulesRevision: revision, stageNumber: profile.stage_number, profileType: profile.profile_type, v4Result: res });
      const loads = model === "v2"
        ? raceConditionLoads(ids, profile.profile_type, null, revision, work ?? { stageNumber: profile.stage_number }, { distanceKm: profile.distance_km ?? null, seasonRaceDaysByRider: new Map(ids.map((id) => [id, EFFORT_6641_CONFIG.seasonRaceDays])) })
        : raceConditionLoads(ids, profile.profile_type, new Map(ids.map((id) => [id, effortOf(id)])), revision, work);
      // --fatigue-revision: tvillingernes indsats-faktor fra en anden revision (fx den
      // slukkede s5_profiles_v3), mens belastningens oevrige led foelger `revision`.
      if (fatigueRevision && fatigueRevision !== revision && !TT.has(profile.profile_type)) {
        for (const l of loads) {
          if (!twinIds.has(l.rider_id)) continue;
          const e = effortOf(l.rider_id);
          const from = effortFatigueMultiplier(e, { profileType: profile.profile_type, rulesRevision: revision });
          const to = effortFatigueMultiplier(e, { profileType: profile.profile_type, rulesRevision: fatigueRevision });
          if (from > 0) l.load = l.load * (to / from);
        }
      }
      for (const { rider_id, load } of loads) {
        if (!loadsToday.has(rider_id)) loadsToday.set(rider_id, []);
        loadsToday.get(rider_id).push(load);
      }
      const out = res.v4Output;
      const fin = new Map((out?.results ?? []).filter((r) => r.status === "finished").map((r) => [r.rider_id, Number(r.time_seconds)]));
      const rank = new Map(res.ranked.map((r) => [r.rider_id, r.rank]));
      const breakIds = new Set([...breakawayRiderIdsFromSnapshots(out?.groupSnapshots ?? [])].map(String));
      const gcRank = new Map(gcAfter.map((g, i) => [g.rider_id, i + 1]));
      const loadById = new Map(loads.map((l) => [l.rider_id, l.load]));
      const row = { stage: profile.stage_number, profile: profile.profile_type, cls: stageClass(profile.profile_type), twins: {} };
      for (const id of twinIds) {
        row.twins[id] = {
          entering: enteringByStage[index].get(id) ?? null,
          time: fin.get(id) ?? null,
          rank: rank.get(id) ?? null,
          gcRank: gcRank.get(id) ?? null,
          inBreak: breakIds.has(id),
          load: loadById.get(id) ?? null,
          out: !rank.has(id) && ids.includes(id),
        };
      }
      perStage.push(row);
      const nextD = index + 1 < sorted.length ? dateIdx[index + 1] : null;
      if (model !== "legacy" && nextD !== dateIdx[index]) {
        settle([...cond.keys()]);
        currentDate = nextD;
      }
      if (index + 1 < sorted.length) enter(index + 1);
    },
  });
  const finalFatigue = new Map([...twinIds].map((id) => [id, model === "legacy" ? null : cond.get(id).fatigue]));
  return { perStage, finalFatigue, nStages: sorted.length, nDates: Math.max(...dateIdx) - Math.min(...dateIdx) + 1 };
}

/** Samler ét loebs koersel til raekker pr. (niveau, trin) (ren). */
export function summarizeRun(run) {
  const rows = [];
  for (const level of Object.keys(LEVELS)) {
    const normalId = twinId(level, "normal");
    for (const effort of EFFORTS) {
      const id = twinId(level, effort);
      const byClass = {};
      let entering = [];
      let maxEntering = 0;
      let stagesAt90 = 0;
      let firstAt100 = null;
      let breaks = 0;
      let out = false;
      let lastGc = null;
      let lastNormalGc = null;
      for (const s of run.perStage) {
        const t = s.twins[id];
        const n = s.twins[normalId];
        if (!t) continue;
        if (t.out) out = true;
        if (Number.isFinite(t.entering)) {
          entering.push(t.entering);
          maxEntering = Math.max(maxEntering, t.entering);
          if (t.entering >= 90) stagesAt90 += 1;
          if (t.entering >= 100 && firstAt100 == null) firstAt100 = s.stage;
        }
        if (t.inBreak) breaks += 1;
        if (t.time != null && n?.time != null) {
          const c = (byClass[s.cls] ??= { dt: [], drank: [] });
          c.dt.push(t.time - n.time);
          if (t.rank != null && n.rank != null) c.drank.push(n.rank - t.rank);
        }
        if (t.gcRank != null) lastGc = t.gcRank;
        if (n?.gcRank != null) lastNormalGc = n.gcRank;
      }
      rows.push({
        level, effort,
        byClass: Object.fromEntries(Object.entries(byClass).map(([k, v]) => [k, { n: v.dt.length, dtMean: mean(v.dt), placesGainedMean: mean(v.drank) }])),
        meanEntering: mean(entering), maxEntering, stagesAt90, firstAt100, breaks, out,
        finalFatigue: run.finalFatigue.get(id), gcRank: lastGc, gcRankVsNormal: lastGc != null && lastNormalGc != null ? lastNormalGc - lastGc : null,
      });
    }
  }
  return rows;
}

/** Aggregat pr. (model, loebsklasse, niveau, trin) (ren). */
export function aggregate(records) {
  const groups = new Map();
  for (const r of records) {
    const key = `${r.model}|${r.raceClass}|${r.level}|${r.effort}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const out = [];
  for (const [key, xs] of groups) {
    const [model, rc, level, effort] = key.split("|");
    const cls = {};
    for (const c of ["flat", "hilly", "mountain", "tt"]) {
      const dt = xs.map((x) => x.byClass[c]?.dtMean).filter((v) => v != null);
      const dr = xs.map((x) => x.byClass[c]?.placesGainedMean).filter((v) => v != null);
      if (dt.length) cls[c] = { dtPerStage: r1(mean(dt)), placesPerStage: r1(mean(dr)) };
    }
    out.push({
      model, raceClass: rc, level, effort, runs: xs.length, perStageClass: cls,
      meanEntering: r1(mean(xs.map((x) => x.meanEntering).filter((v) => v != null))),
      maxEntering: r1(Math.max(...xs.map((x) => x.maxEntering))),
      stagesAt90: r1(mean(xs.map((x) => x.stagesAt90))),
      shareHit100: r1(100 * xs.filter((x) => x.firstAt100 != null).length / xs.length),
      firstAt100: r1(mean(xs.map((x) => x.firstAt100).filter((v) => v != null))),
      breaksPerRace: r1(mean(xs.map((x) => x.breaks))),
      outShare: r1(100 * xs.filter((x) => x.out).length / xs.length),
      finalFatigue: r1(mean(xs.map((x) => x.finalFatigue).filter((v) => v != null))),
      gcPlacesVsNormal: r1(mean(xs.map((x) => x.gcRankVsNormal).filter((v) => v != null))),
    });
  }
  return out.sort((a, b) => a.model.localeCompare(b.model) || a.raceClass.localeCompare(b.raceClass) || a.level.localeCompare(b.level) || EFFORTS.indexOf(a.effort) - EFFORTS.indexOf(b.effort));
}

/** Synteseloeb: fem bjergetaper i traek (den kendte fejl fra 6/9), én etape pr. dato. */
export function fiveMountainRace(allRaces) {
  const pool = allRaces.flatMap((r) => r.stages.filter((s) => s.profile_type === "mountain" || s.profile_type === "high_mountain"));
  if (pool.length < 5) return null;
  const stages = pool.slice(0, 5).map((s, i) => ({ ...s, stage_number: i + 1, game_day: 100 + i * SLOTS }));
  return { seasonId: "s5-dryrun-syn", race: { id: "syn-5mtn", name: "syn", race_type: "stage", stages: 5 }, stages, grandTour: false };
}

export async function runEffortLevels({ genSeeds = 1, simSeeds = 2, maxRaces = 12, revision = "s5_profiles_v2", models = MODELS, classes = null, fatigueRevision = null } = {}) {
  const v4 = await loadRaceEngineV4();
  const field = loadBenchField();
  const templates = pickTemplates(field.abilities);
  const all = buildS5BenchRaces({ scope: "all", genSeeds });
  const stageRaces = all.filter((r) => r.stages.length >= 3);
  // Spred udvalget over klasserne: mountain/mixed/flat skiftevis, GT'er med.
  const byClass = { mountain: [], mixed: [], flat: [] };
  for (const r of stageRaces) byClass[raceClass(r.stages)]?.push(r);
  const picked = [];
  for (let i = 0; picked.length < maxRaces && i < stageRaces.length; i++) {
    for (const c of ["mountain", "mixed", "flat"]) if (byClass[c][i] && picked.length < maxRaces) picked.push(byClass[c][i]);
  }
  const syn = fiveMountainRace(all);
  const races = (syn ? [{ ...syn, cls: "5mtn" }, ...picked.map((r) => ({ ...r, cls: raceClass(r.stages) }))] : picked.map((r) => ({ ...r, cls: raceClass(r.stages) })))
    .filter((r) => !classes || classes.includes(r.cls));
  const records = [];
  const raceMeta = [];
  for (const r of races) {
    raceMeta.push({ cls: r.cls, stages: r.stages.length, grandTour: r.grandTour, profiles: r.stages.map((s) => s.profile_type) });
    for (const model of models) {
      for (let s = 1; s <= simSeeds; s++) {
        const run = runRace({ v4, field, race: r.race, stages: r.stages, seasonId: r.seasonId, simSeed: s, revision, model, templates, fatigueRevision });
        for (const row of summarizeRun(run)) records.push({ ...row, model, raceClass: r.cls, race: r.race.id, seed: s });
      }
    }
    process.stderr.write(".");
  }
  process.stderr.write("\n");
  return {
    config: { genSeeds, simSeeds, maxRaces, revision, fatigueRevision, models, ...EFFORT_6641_CONFIG },
    multipliers: {
      fatigue: Object.fromEntries(EFFORTS.map((e) => [e, effortFatigueMultiplier(e, { rulesRevision: fatigueRevision ?? revision })])),
      grupettoByProfile: Object.fromEntries(["flat", "rolling", "hilly", "mountain", "high_mountain"].map((p) => [p, effortFatigueMultiplier("grupetto", { profileType: p, rulesRevision: fatigueRevision ?? revision })])),
      development: Object.fromEntries(EFFORTS.map((e) => [e, effortDevelopmentMultiplier(e)])),
    },
    races: raceMeta,
    aggregate: aggregate(records),
    records,
  };
}

/** Kort markdown-tabel (privat). */
export function renderMarkdown(res, label) {
  const lines = [`# #6641 indsatstrin: ${label}`, "", `revision ${res.config.revision} · ${res.races.length} loeb · ${res.config.simSeeds} seeds · start-traethed ${res.config.startFatigue}`, ""];
  lines.push("| model | loeb | niveau | trin | s/etape fladt | s/etape kuperet | s/etape bjerg | pladser/etape bjerg | GC-pladser | snit-traethed ind | max | etaper >=90 | ramte 100 % | udbrud/loeb | ude % | slut-traethed |");
  lines.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const a of res.aggregate) {
    const c = a.perStageClass;
    lines.push(`| ${a.model} | ${a.raceClass} | ${a.level} | ${a.effort} | ${c.flat?.dtPerStage ?? ""} | ${c.hilly?.dtPerStage ?? ""} | ${c.mountain?.dtPerStage ?? ""} | ${c.mountain?.placesPerStage ?? ""} | ${a.gcPlacesVsNormal ?? ""} | ${a.meanEntering ?? ""} | ${a.maxEntering ?? ""} | ${a.stagesAt90} | ${a.shareHit100} | ${a.breaksPerRace} | ${a.outShare} | ${a.finalFatigue ?? ""} |`);
  }
  return lines.join("\n");
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  const arg = (name, fallback) => { const hit = process.argv.find((a) => a.startsWith(`--${name}=`)); return hit ? hit.slice(name.length + 3) : fallback; };
  const res = await runEffortLevels({
    genSeeds: Number(arg("gen-seeds", "1")),
    simSeeds: Number(arg("sim-seeds", "2")),
    maxRaces: Number(arg("max-races", "12")),
    revision: arg("revision", "s5_profiles_v2"),
    models: arg("models", MODELS.join(",")).split(","),
    classes: arg("classes", null)?.split(",") ?? null,
    fatigueRevision: arg("fatigue-revision", null),
  });
  const label = arg("label", "baseline");
  const out = arg("out", null);
  const md = renderMarkdown(res, label);
  if (out) {
    const dir = path.resolve(REPO_ROOT, out);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, `effort-levels-${label}.json`), JSON.stringify(res, null, 2));
    writeFileSync(path.join(dir, `effort-levels-${label}.md`), md);
    console.error(`skrev ${path.join(dir, `effort-levels-${label}.{json,md}`)}`);
  } else {
    console.log(md);
  }
}
