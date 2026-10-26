#!/usr/bin/env node
// backend/scripts/dev/tacticsEffects7266.mjs
// #7266 (ejer 26/10, taktik-pakken): virker hver af spillerens ordrer under
// s5_profiles_v3 i den forventede retning, og kan den maerkes? Maalt paa S5-eksporten
// (<race_id>/cache.json, samme mappe som motor-testporten koerte), opdelt paa
// loebsgrupper: endagsloeb, korte etapeloeb, Grand Tours, monumenter og U23/junior.
//
// METODE: tvillinger (samme som #6641, effortLevels6641.mjs). Hver ordre maales mod en
// tvilling UDEN ordren. Motorens rng laeser rider-id'et, saa en KONTROL-tvilling (samme
// ryttere, ingen ordre, andre id'er) giver maalingens stoej. En ordre "kan maerkes" naar
// forskellen ordre-mod-tvilling slaar kontrollens forskel med mindst NOISE_Z standardfejl.
//
//   Enkeltryttere (alle tvillinger i SAMME koersel, hver paa sit eget menneskehold):
//     effort    de 5 indsatstrin (fri rolle) + kontrol paa normal. Tid paa dagen (friske
//               ben, dage hvor tvillingen eller normal-tvillingen sad i udbruddet udelades,
//               som #6641) og etapens belastning (traetheden bagefter).
//     break     "Forsoeg udbrud" (hjaelper, normal) mod samme uden. Forsoeg og plads i
//               udbruddet. Plus grupetto + forsoeg udbrud (en spaerret modsaetning): motoren
//               maa aldrig lade ham forsoege.
//     plan      etapeplanen (stage_plan_v1, stagePlanEngine.ts): skift ved de sidste km, ved
//               toppen af en stigning og ved "sat", mod samme forste opgave hele dagen.
//   Hele hold (parrede koersler: samme seed, kun ordren aendres; kontrol = samme hold med
//   andre rider-id'er):
//     train     sprinttog (spurtkaptajn + hjaelpere med tog) mod samme hold uden tog, flade dage.
//     chase     jagt-stance: holdet med den staerkeste kaptajn paa "jag" mod "lad gaa" (og neutral).
//     cocaptain delt kaptajn paa et hold med 7-8 ryttere: naestbedste klassementsrytter som delt
//               kaptajn mod som hjaelper. Etapeloeb koeres hele loebet (klassement), endagsloeb
//               som én dag.
//   API: spaerrede modsaetninger (spec 2026-10-25-taktik-roller-design.md par. 3 + 11) sendt
//   gennem validateTeamOrder (klassisk) og validateRiderPlans (etapeplan).
//
// Smaa felter (GT/monumenter i eksporten har kun de tilmeldte hold) fyldes op med hele hold
// fra et andet seniorloeb i eksporten (nye id'er, AI-hold), saa udbrud og jagt har et felt.
//
// HARD RULE 17: maalte tal skrives KUN til balance-internals/ (gitignoreret). Offline:
// ingen DB, ingen prod. Ingen motor-aendring.
//
// Koer (fra repo-roden):
//   node backend/scripts/dev/tacticsEffects7266.mjs --from-dir=<eksport>/races --out=balance-internals/7266
//     [--label=v3] [--seeds=2] [--groups=one_day:20,short_stage:10,gt:3,monument:5,youth:12]
//     [--experiments=effort,break,plan,train,chase,cocaptain,api] [--revision=s5_profiles_v3]
//
// Refs #7266 #7003 #5981 #6641

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { runStagesInOrder, sortedStages, splitEntrants, breakawayWin, isBunchSprintStage } from "./lib/tourScorecard.mjs";
import { loadRaceEngineV4, breakawayRiderIdsFromSnapshots } from "../../lib/raceEngineV4Bridge.js";
import { raceConditionLoads, stageConditionWork } from "../../lib/raceFatigue.js";
import { validateTeamOrder } from "../../lib/raceTeamOrdersApi.js";
import { validateRiderPlans } from "../../lib/stagePlanApi.js";
import { legacyOrderFromPlan, stagePlanRouteFromRaw } from "../../lib/stagePlan.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, "..", "..", "..");

export const REVISION = "s5_profiles_v3";
export const GROUPS = Object.freeze(["one_day", "short_stage", "gt", "monument", "youth"]);
export const DEFAULT_GROUP_CAPS = Object.freeze({ one_day: 20, short_stage: 10, gt: 3, monument: 5, youth: 12 });
export const EXPERIMENTS = Object.freeze(["effort", "break", "plan", "train", "chase", "cocaptain", "api"]);
export const EFFORTS = Object.freeze(["grupetto", "save", "normal", "protect", "all_out"]);
export const LEVELS = Object.freeze({ mid: 0.5, strong: 0.9, top: 0.99 });
/** "Kan maerkes": ordre-forskellen slaar kontrollens med mindst saa mange standardfejl. */
export const NOISE_Z = 2;
/** Felter under denne stoerrelse fyldes op (GT/monumenter i eksporten). */
export const MIN_FIELD = 90;
/** Sprinttogets maal: feltets sprinter nr. SPRINTER_INDEX + 1. */
export const SPRINTER_INDEX = 4;
const TT = new Set(["itt", "itt_hilly", "ttt"]);
const GT_CLASSES = new Set(["GiroVuelta", "TourFrance"]);

const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
/** Fortegn for en tidsforskel: -1 hurtigere, 0 samme tid, +1 langsommere (null bevares). */
export const sgn = (x) => (x == null || !Number.isFinite(x) ? null : Math.sign(x));
const r2 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 100) / 100);

// ── Rene hjaelpere ──────────────────────────────────────────────────────────

/** Loebsgruppen for et loeb fra eksporten (ren). */
export function raceGroup(race) {
  if (race?.squad && race.squad !== "senior") return "youth";
  if (GT_CLASSES.has(race?.race_class)) return "gt";
  if (race?.race_class === "Monuments") return "monument";
  return Number(race?.stages) > 1 ? "short_stage" : "one_day";
}

/** Terraen-klasse for én etape (ren). */
export function stageClass(profileType) {
  if (TT.has(profileType)) return "tt";
  if (profileType === "high_mountain" || profileType === "mountain" || profileType === "medium_mountain") return "mountain";
  if (profileType === "flat" || profileType === "rolling") return "flat";
  return "hilly";
}

/** k jaevnt fordelte elementer (deterministisk, ren). */
export function pickEvenly(xs, k) {
  if (k >= xs.length) return xs.slice();
  const out = [];
  for (let i = 0; i < k; i++) out.push(xs[Math.floor((i * xs.length) / k)]);
  return out;
}

const strengthOf = (a) => (Number(a.climbing) || 0) + (Number(a.durability) || 0) + (Number(a.punch) || 0);
const gcStrength = (a) => (Number(a?.climbing) || 0) + (Number(a?.time_trial) || 0) + (Number(a?.durability) || 0) + (Number(a?.recovery) || 0);
const sprintStrength = (a) => (Number(a?.sprint) || 0) + (Number(a?.acceleration) || 0);

/** Skabelon-ryttere ved percentilerne i LEVELS (ren, som #6641). */
export function pickTemplates(abilities) {
  const sorted = abilities.slice().sort((x, y) => strengthOf(x) - strengthOf(y) || String(x.rider_id).localeCompare(String(y.rider_id)));
  const out = {};
  for (const [level, p] of Object.entries(LEVELS)) out[level] = sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))];
  return out;
}

/**
 * Fyld et lille felt op med hele hold fra donor-loeb (nye id'er, AI-hold). Ren.
 * Donorerne er andre seniorloeb i eksporten i fast raekkefoelge.
 */
export function fillField(data, donors, minField = MIN_FIELD) {
  if ((data.entries?.length ?? 0) >= minField) return { data, filled: 0 };
  const entries = [...data.entries];
  const abilities = [...data.abilities];
  const teams = [...data.teams];
  let filled = 0;
  for (const [di, donor] of donors.entries()) {
    if (donor.race.id === data.race.id) continue;
    const abById = new Map(donor.abilities.map((a) => [a.rider_id, a]));
    const byTeam = new Map();
    for (const e of donor.entries) {
      if (!byTeam.has(e.team_id)) byTeam.set(e.team_id, []);
      byTeam.get(e.team_id).push(e);
    }
    for (const [teamId, members] of [...byTeam.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0])))) {
      if (entries.length >= minField) break;
      const newTeam = `fill${di}-${teamId}`;
      teams.push({ id: newTeam, is_ai: true });
      for (const e of members) {
        const ab = abById.get(e.rider_id);
        if (!ab) continue;
        const id = `fill${di}-${e.rider_id}`;
        entries.push({ rider_id: id, team_id: newTeam, race_role: e.race_role ?? null });
        abilities.push({ ...ab, rider_id: id });
        filled += 1;
      }
    }
    if (entries.length >= minField) break;
  }
  return { data: { ...data, entries, abilities, teams }, filled };
}

/**
 * Ordre mod tvilling, maalt mod kontrollens stoej (ren).
 * dOn: ordre minus tvilling pr. maaling. dCtrl: kontrol minus tvilling pr. maaling.
 * sign: forventet fortegn for dOn (+1 eller -1).
 */
export function effectStats(dOn, dCtrl, sign) {
  const on = dOn.filter((v) => v != null && Number.isFinite(v));
  const ctrl = dCtrl.filter((v) => v != null && Number.isFinite(v));
  const variance = (xs, m) => (xs.length > 1 ? xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1) : 0);
  const mOn = mean(on);
  const mCtrl = mean(ctrl) ?? 0;
  if (mOn == null) return { n: 0, nCtrl: ctrl.length, meanOn: null, meanCtrl: r2(mCtrl), z: null, directionOk: null, wrong: null, beatsNoise: null };
  const se = Math.sqrt(variance(on, mOn) / on.length + (ctrl.length ? variance(ctrl, mCtrl) / ctrl.length : 0));
  const diff = sign * (mOn - mCtrl);
  const z = se > 0 ? diff / se : diff > 0 ? Infinity : 0;
  const directionOk = sign * mOn > 0;
  return { n: on.length, nCtrl: ctrl.length, meanOn: r2(mOn), meanCtrl: r2(mCtrl), z: Number.isFinite(z) ? r2(z) : z, directionOk, wrong: sign * mOn < 0, beatsNoise: directionOk && z >= NOISE_Z };
}

/**
 * Spaerrede modsaetninger mod API'et (ren). Spec par. 3 (klassisk raekke) og par. 11
 * (etapeplanen). Returnerer [{ id, path, expectReject, rejected, error }].
 */
export function apiContradictionChecks() {
  const ids = new Set(["h1", "h2", "s1", "c1"]);
  const base = { raceCompleted: false, stageNumber: 1, stageCount: 3, stagesCompleted: 0, scheduledAt: null, teamRiderIds: ids, intentionEnabled: true };
  const classic = (id, rider) => {
    const res = validateTeamOrder({ ...base, order: { breakaway_stance: "neutral", riders: [{ rider_id: "h1", effort: "normal", try_break: false, leadout: false, ...rider }] } });
    return { id, path: "classic", expectReject: true, rejected: !res.ok, error: res.errors[0] ?? null };
  };
  const route = { distance_km: 180, profile_type: "mountain", climbs: [{ index: 0, km: 60, name: null, category: "2" }, { index: 1, km: 140, name: null, category: "1" }], summit_finish: true };
  const roleByRider = new Map([["h1", "helper"], ["h2", "hunter"], ["s1", "sprint_captain"], ["c1", "captain"]]);
  const plan = (id, riderId, legs, expectReject = true) => {
    const err = validateRiderPlans([{ rider_id: riderId, plan: legs }], { route, roleByRider, hasRoute: true });
    return { id, path: "stage_plan", expectReject, rejected: err !== null, error: err };
  };
  return [
    classic("grupetto_plus_try_break", { effort: "grupetto", try_break: true }),
    classic("grupetto_plus_sprint_train", { effort: "grupetto", leadout: true }),
    classic("work_plus_try_break", { effort: "protect", try_break: true }),
    classic("sprint_train_plus_try_break", { leadout: true, try_break: true }),
    plan("plan_breakaway_not_first", "h1", [{ task: "shelter_leader" }, { task: "breakaway", from: { at: "final_km" } }]),
    plan("plan_grupetto_before_work", "h1", [{ task: "grupetto" }, { task: "tempo", from: { at: "final_km" } }]),
    plan("plan_train_after_dropped", "h1", [{ task: "shelter_leader" }, { task: "sprint_train", from: { at: "dropped" } }]),
    plan("plan_captain_grupetto", "c1", [{ task: "stay_sheltered" }, { task: "grupetto", from: { at: "dropped" } }]),
    plan("plan_backwards_in_time", "h1", [{ task: "shelter_leader" }, { task: "tempo", from: { at: "kom", kom_index: 1 } }, { task: "ride_in", from: { at: "kom", kom_index: 0 } }]),
    plan("plan_dropped_not_last", "h1", [{ task: "shelter_leader" }, { task: "ride_in", from: { at: "dropped" } }, { task: "tempo", from: { at: "final_km" } }]),
    // Par. 3: sprinttog + forsoeg udbrud er udelukket. I planen kan udbrud (foerste led) og
    // sprinttog (sidste led) staa i samme kaede, og de afledte felter baerer saa begge flag.
    plan("plan_breakaway_then_sprint_train", "h1", [{ task: "breakaway" }, { task: "sprint_train", from: { at: "final_km" } }]),
    // Kontrol: en gyldig plan skal ikke afvises.
    plan("plan_valid_helper_chain", "h1", [{ task: "shelter_leader" }, { task: "tempo", from: { at: "kom", kom_index: 0 } }, { task: "grupetto", from: { at: "dropped" } }], false),
  ];
}

// ── Eksporten ───────────────────────────────────────────────────────────────

/** Alle loeb i eksporten (mapper med cache.json), sorteret paa id. */
export function loadExport(dir) {
  const out = [];
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const file = path.join(dir, d.name, "cache.json");
    if (!existsSync(file)) continue;
    const data = JSON.parse(readFileSync(file, "utf8"));
    if (!data?.race || !Array.isArray(data.profiles) || !data.profiles.length) continue;
    out.push({ id: data.race.id, group: raceGroup(data.race), data });
  }
  return out.sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

/** Udvalget pr. gruppe (jaevnt fordelt over eksporten). */
export function selectRaces(all, caps = DEFAULT_GROUP_CAPS) {
  const out = [];
  for (const g of GROUPS) out.push(...pickEvenly(all.filter((r) => r.group === g), caps[g] ?? 0));
  return out;
}

// ── Koersel ─────────────────────────────────────────────────────────────────

function simulate(v4, data, stages, profile, entrants, rows, seedTag, revision, gcStandings = null) {
  return v4.simulateStage({
    entrants, stageProfile: profile, seedString: `${data.race.id}:${profile.stage_number}:t7266-${seedTag}`, stageNumber: profile.stage_number,
    teamOrderRows: rows, isStageRace: stages.length > 1, raceStages: stages, squad: data.race.squad ?? null, rulesRevision: revision, gcStandings,
  });
}

function clone(tpl, id) {
  const { rider_id: _r, ...ab } = tpl;
  return { rider_id: id, ...ab };
}

const twinEntrant = (id, teamId, role, effort, abilities) => ({ rider_id: id, team_id: teamId, team_is_ai: false, race_role: role, effort, abilities });
const twinRow = (teamId, stageNumber, riders, stance = "neutral") => ({ team_id: teamId, stage_number: stageNumber, breakaway_stance: stance, riders });

function outcome(res) {
  const out = res.v4Output;
  const fin = new Map((out?.results ?? []).filter((r) => r.status === "finished").map((r) => [r.rider_id, Number(r.time_seconds)]));
  const rank = new Map(res.ranked.map((r) => [r.rider_id, r.rank]));
  const breakIds = new Set([...breakawayRiderIdsFromSnapshots(out?.groupSnapshots ?? [])].map(String));
  const events = out?.timeline?.events ?? [];
  const attempts = new Set(events.filter((e) => e.type === "breakaway_attempt").flatMap((e) => e.params?.rider_ids ?? []).map(String));
  const legEvents = events.filter((e) => e.type === "stage_plan_leg");
  return { fin, rank, breakIds, attempts, legEvents, out };
}

/** Effort-tvillinger: fri rolle, 5 trin + kontrol, tre niveauer, i én koersel. */
function runEffortDay(ctx) {
  const { v4, data, stages, profile, field, templates, seed, revision, rec } = ctx;
  const entrants = [...field];
  const rows = [...(data.orders ?? []).filter((o) => o.stage_number === profile.stage_number)];
  const arms = [...EFFORTS, "ctrl"];
  for (const [level, tpl] of Object.entries(templates)) {
    for (const arm of arms) {
      const id = `t7266-eff-${level}-${arm}`;
      const effort = arm === "ctrl" ? "normal" : arm;
      const team = `team-${id}`;
      const { rider_id: _r, ...ab } = clone(tpl, id);
      entrants.push(twinEntrant(id, team, "free_role", effort, ab));
      rows.push(twinRow(team, profile.stage_number, [{ rider_id: id, effort, try_break: false, leadout: false }]));
    }
  }
  const res = simulate(v4, data, stages, profile, entrants, rows, `eff-${seed}`, revision);
  const o = outcome(res);
  const work = stageConditionWork({ rulesRevision: revision, stageNumber: profile.stage_number, profileType: profile.profile_type, v4Result: res });
  const twinIds = entrants.filter((e) => e.rider_id.startsWith("t7266-eff-")).map((e) => e.rider_id);
  const effortById = new Map(entrants.filter((e) => twinIds.includes(e.rider_id)).map((e) => [e.rider_id, e.effort]));
  const loads = new Map(raceConditionLoads(twinIds, profile.profile_type, effortById, revision, work).map((l) => [l.rider_id, l.load]));
  for (const level of Object.keys(templates)) {
    const nid = `t7266-eff-${level}-normal`;
    const cid = `t7266-eff-${level}-ctrl`;
    const breakDay = (id) => o.breakIds.has(id) || o.breakIds.has(nid);
    const dt = (id) => (o.fin.has(id) && o.fin.has(nid) && !breakDay(id) ? o.fin.get(id) - o.fin.get(nid) : null);
    const dl = (id) => (loads.has(id) && loads.has(nid) ? loads.get(id) - loads.get(nid) : null);
    for (const effort of EFFORTS) {
      if (effort === "normal") continue;
      const id = `t7266-eff-${level}-${effort}`;
      rec({ exp: "effort", arm: effort, level, metric: "time", dOn: dt(id), dCtrl: dt(cid) });
      rec({ exp: "effort", arm: effort, level, metric: "time_sign", dOn: sgn(dt(id)), dCtrl: sgn(dt(cid)) });
      rec({ exp: "effort", arm: effort, level, metric: "load", dOn: dl(id), dCtrl: dl(cid) });
    }
  }
}

/** Udbrud + etapeplan: enkeltryttere i én koersel. */
function runOrdersDay(ctx) {
  const { v4, data, stages, profile, field, templates, seed, revision, rec, experiments } = ctx;
  const entrants = [...field];
  const rows = [...(data.orders ?? []).filter((o) => o.stage_number === profile.stage_number)];
  const add = (id, role, rider, tpl) => {
    const team = `team-${id}`;
    const { rider_id: _r, ...ab } = clone(tpl, id);
    entrants.push(twinEntrant(id, team, role, rider.effort, ab));
    rows.push(twinRow(team, profile.stage_number, [{ rider_id: id, try_break: false, leadout: false, ...rider }]));
  };
  const levels = Object.entries(templates);
  const doBreak = experiments.includes("break");
  const route = stagePlanRouteFromRaw(profile);
  const doPlan = experiments.includes("plan") && !TT.has(profile.profile_type);
  const lastClimb = route.climbs.length ? route.climbs[route.climbs.length - 1] : null;
  const planRider = (legs) => ({ ...legacyOrderFromPlan(legs), plan: legs });
  const PLANS = {
    final: { role: "free_role", on: [{ task: "stay_sheltered" }, { task: "attack", from: { at: "final_km" } }], off: [{ task: "stay_sheltered" }], reason: "final_km" },
    kom: lastClimb ? { role: "free_role", on: [{ task: "stay_sheltered" }, { task: "attack", from: { at: "kom", kom_index: lastClimb.index } }], off: [{ task: "stay_sheltered" }], reason: "kom" } : null,
    dropped: { role: "helper", on: [{ task: "shelter_leader" }, { task: "grupetto", from: { at: "dropped" } }], off: [{ task: "shelter_leader" }], reason: "dropped" },
  };
  for (const [level, tpl] of levels) {
    if (doBreak) {
      add(`t7266-brk-${level}-on`, "helper", { effort: "normal", try_break: true }, tpl);
      add(`t7266-brk-${level}-off`, "helper", { effort: "normal" }, tpl);
      add(`t7266-brk-${level}-ctrl`, "helper", { effort: "normal" }, tpl);
      add(`t7266-brk-${level}-grupetto`, "helper", { effort: "grupetto", try_break: true }, tpl);
    }
    if (doPlan && level !== "top") {
      for (const [kind, p] of Object.entries(PLANS)) {
        if (!p) continue;
        add(`t7266-pln-${kind}-${level}-on`, p.role, planRider(p.on), tpl);
        add(`t7266-pln-${kind}-${level}-off`, p.role, planRider(p.off), tpl);
        add(`t7266-pln-${kind}-${level}-ctrl`, p.role, planRider(p.off), tpl);
      }
    }
  }
  if (!doBreak && !doPlan) return;
  const res = simulate(v4, data, stages, profile, entrants, rows, `ord-${seed}`, revision);
  const o = outcome(res);
  const bit = (b) => (b ? 1 : 0);
  for (const [level] of levels) {
    if (doBreak && !TT.has(profile.profile_type)) {
      const on = `t7266-brk-${level}-on`, off = `t7266-brk-${level}-off`, ctrl = `t7266-brk-${level}-ctrl`;
      rec({ exp: "break", arm: "try_break", level, metric: "attempt", dOn: bit(o.attempts.has(on)) - bit(o.attempts.has(off)), dCtrl: bit(o.attempts.has(ctrl)) - bit(o.attempts.has(off)) });
      rec({ exp: "break", arm: "try_break", level, metric: "in_break", dOn: bit(o.breakIds.has(on)) - bit(o.breakIds.has(off)), dCtrl: bit(o.breakIds.has(ctrl)) - bit(o.breakIds.has(off)) });
      rec({ exp: "break", arm: "grupetto_try_break", level, metric: "attempt_invariant", value: bit(o.attempts.has(`t7266-brk-${level}-grupetto`)) });
    }
    if (doPlan && level !== "top") {
      for (const [kind, p] of Object.entries(PLANS)) {
        if (!p) continue;
        const on = `t7266-pln-${kind}-${level}-on`, off = `t7266-pln-${kind}-${level}-off`, ctrl = `t7266-pln-${kind}-${level}-ctrl`;
        const dt = (id) => (o.fin.has(id) && o.fin.has(off) ? o.fin.get(id) - o.fin.get(off) : null);
        const fired = (id) => bit(o.legEvents.some((e) => e.params?.rider_id === id && e.params?.reason === p.reason));
        rec({ exp: "plan", arm: kind, level, metric: "time", dOn: dt(on), dCtrl: dt(ctrl) });
        rec({ exp: "plan", arm: kind, level, metric: "time_sign", dOn: sgn(dt(on)), dCtrl: sgn(dt(ctrl)) });
        rec({ exp: "plan", arm: kind, level, metric: "switch_fired", dOn: fired(on) - fired(off), dCtrl: fired(ctrl) - fired(off) });
      }
    }
  }
}

/** Et menneskehold af kloner (nye id'er) med givne roller. */
function cloneTeam(members, prefix) {
  return members.map((m, i) => ({ ...m, rider_id: `${prefix}-${i}`, team_id: `team-${prefix}`, team_is_ai: false }));
}

/** Sprinttog: parret koersel, flade spurtdage. */
function runTrainDay(ctx) {
  const { v4, data, stages, profile, field, templates, seed, revision, rec } = ctx;
  if (TT.has(profile.profile_type) || !isBunchSprintStage(profile)) return;
  // Feltets femtebedste sprinter: plads til at vinde placeringer (den bedste vinder ofte alligevel).
  const bySprint = field.slice().sort((a, b) => sprintStrength(b.abilities) - sprintStrength(a.abilities) || a.rider_id.localeCompare(b.rider_id));
  const sprinter = bySprint[Math.min(SPRINTER_INDEX, bySprint.length - 1)];
  const helperTpl = templates.mid;
  const { rider_id: _r, ...helperAb } = helperTpl;
  const members = [{ race_role: "sprint_captain", effort: "normal", abilities: sprinter.abilities }];
  for (let i = 0; i < 6; i++) members.push({ race_role: "helper", effort: "normal", abilities: helperAb });
  const others = (data.orders ?? []).filter((o) => o.stage_number === profile.stage_number);
  const run = (prefix, train) => {
    const team = cloneTeam(members, prefix);
    const row = twinRow(`team-${prefix}`, profile.stage_number, team.map((t) => ({ rider_id: t.rider_id, effort: "normal", try_break: false, leadout: train && t.race_role === "helper" })));
    const o = outcome(simulate(v4, data, stages, profile, [...field, ...team], [...others, row], `trn-${seed}`, revision));
    const capId = team[0].rider_id;
    return { rank: o.rank.get(capId) ?? null, time: o.fin.get(capId) ?? null };
  };
  const on = run("t7266-trn", true);
  const off = run("t7266-trn", false);
  const ctrl = run("t7266-trnc", false);
  const d = (a, b) => (a != null && b != null ? a - b : null);
  rec({ exp: "train", arm: "sprint_train", level: "team", metric: "captain_rank", dOn: d(on.rank, off.rank), dCtrl: d(ctrl.rank, off.rank) });
}

/** Det hold i feltet med den staerkeste kaptajn (mindst 5 ryttere). */
function strongestTeam(field) {
  const byTeam = new Map();
  for (const e of field) {
    if (!byTeam.has(e.team_id)) byTeam.set(e.team_id, []);
    byTeam.get(e.team_id).push(e);
  }
  let best = null;
  for (const [teamId, members] of [...byTeam.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0])))) {
    if (members.length < 5) continue;
    const top = Math.max(...members.map((m) => gcStrength(m.abilities)));
    if (!best || top > best.top) best = { teamId, members, top };
  }
  return best;
}

/** Jagt-stance: parret koersel paa vejetaper. */
function runChaseDay(ctx) {
  const { v4, data, stages, profile, field, seed, revision, rec } = ctx;
  if (TT.has(profile.profile_type)) return;
  const pick = strongestTeam(field);
  if (!pick) return;
  const rest = field.filter((e) => e.team_id !== pick.teamId);
  const sorted = pick.members.slice().sort((a, b) => gcStrength(b.abilities) - gcStrength(a.abilities) || a.rider_id.localeCompare(b.rider_id));
  const members = sorted.map((m, i) => ({ race_role: i === 0 ? "captain" : (m.race_role === "captain" ? "helper" : m.race_role ?? "helper"), effort: "normal", abilities: m.abilities }));
  const others = (data.orders ?? []).filter((o) => o.stage_number === profile.stage_number && o.team_id !== pick.teamId);
  const run = (prefix, stance) => {
    const team = cloneTeam(members, prefix);
    const row = twinRow(`team-${prefix}`, profile.stage_number, [], stance);
    const o = outcome(simulate(v4, data, stages, profile, [...rest, ...team], [...others, row], `chs-${seed}`, revision));
    return { won: breakawayWin(o.out).won ? 1 : 0, ...breakLead(o) };
  };
  const chase = run("t7266-chs", "chase");
  const neutral = run("t7266-chs", "neutral");
  const letGo = run("t7266-chs", "let_go");
  const ctrl = run("t7266-chsc", "neutral");
  if (!(chase.formed || neutral.formed || letGo.formed)) return;
  const d = (a, b) => (a != null && b != null ? a - b : null);
  for (const [arm, other] of [["chase_vs_let_go", letGo], ["chase_vs_neutral", neutral]]) {
    rec({ exp: "chase", arm, level: "team", metric: "break_won", dOn: chase.won - other.won, dCtrl: ctrl.won - neutral.won });
    rec({ exp: "chase", arm, level: "team", metric: "break_lead", dOn: d(chase.lead, other.lead), dCtrl: d(ctrl.lead, neutral.lead) });
  }
}

/**
 * Udbruddets forspring i maal: bedste rytter uden for morgenudbruddet minus bedste
 * udbryder (> 0 = udbruddet foran). null uden udbrud eller uden maal-tider.
 */
export function breakLead(o) {
  const formedIds = new Set((o.out?.timeline?.events ?? []).filter((e) => e.type === "breakaway_formed").flatMap((e) => e.params?.rider_ids ?? []).map(String));
  if (!formedIds.size) return { formed: false, lead: null };
  let bestBreak = Infinity;
  let bestOther = Infinity;
  for (const [id, t] of o.fin) {
    if (formedIds.has(String(id))) bestBreak = Math.min(bestBreak, t);
    else bestOther = Math.min(bestOther, t);
  }
  return { formed: true, lead: Number.isFinite(bestBreak) && Number.isFinite(bestOther) ? bestOther - bestBreak : null };
}

/** Holdet til delt kaptajn: 7-8 ryttere, kaptajn = bedste klassementsrytter, kandidat = naestbedste. */
function coCaptainMembers(field, templates, targetSize) {
  const pick = strongestTeam(field);
  if (!pick) return null;
  const sorted = pick.members.slice().sort((a, b) => gcStrength(b.abilities) - gcStrength(a.abilities) || a.rider_id.localeCompare(b.rider_id)).slice(0, targetSize);
  const { rider_id: _r, ...padAb } = templates.mid;
  while (sorted.length < targetSize) sorted.push({ abilities: padAb });
  return { teamId: pick.teamId, size: sorted.length, members: sorted.map((m, i) => ({ race_role: i === 0 ? "captain" : "helper", effort: "normal", abilities: m.abilities })) };
}

function runCoCaptainRace(ctx) {
  const { v4, data, stages, field, templates, seed, revision, rec, group } = ctx;
  const targetSize = group === "gt" ? 8 : 7;
  const team = coCaptainMembers(field, templates, targetSize);
  if (!team) return;
  const rest = field.filter((e) => e.team_id !== team.teamId);
  const others = (data.orders ?? []).filter((o) => o.team_id !== team.teamId);
  const run = (prefix, coRole) => {
    const members = cloneTeam(team.members.map((m, i) => (i === 1 ? { ...m, race_role: coRole } : m)), prefix);
    const ids = { cap: members[0].rider_id, co: members[1].rider_id };
    const entrants = [...rest, ...members];
    if (stages.length > 1) {
      const raceData = { ...data, orders: others };
      const gc = runStagesInOrder({ v4, data: raceData, revision, seedTag: `t7266-coc-${seed}`, stages, entrants });
      const pos = new Map(gc.map((g, i) => [g.rider_id, i + 1]));
      const last = entrants.length + 1;
      return { cap: pos.get(ids.cap) ?? last, co: pos.get(ids.co) ?? last };
    }
    const o = outcome(simulate(v4, data, stages, stages[0], entrants, others, `coc-${seed}`, revision));
    const last = entrants.length + 1;
    return { cap: o.rank.get(ids.cap) ?? last, co: o.rank.get(ids.co) ?? last };
  };
  const on = run("t7266-coc", "co_captain");
  const off = run("t7266-coc", "helper");
  const ctrl = run("t7266-cocc", "helper");
  const metric = stages.length > 1 ? "gc_rank" : "stage_rank";
  rec({ exp: "cocaptain", arm: `co_captain_${team.size}`, level: "team", metric: `co_${metric}`, dOn: on.co - off.co, dCtrl: ctrl.co - off.co, cls: "race" });
  rec({ exp: "cocaptain", arm: `co_captain_${team.size}`, level: "team", metric: `captain_${metric}`, dOn: on.cap - off.cap, dCtrl: ctrl.cap - off.cap, cls: "race" });
}

// ── Opsummering ─────────────────────────────────────────────────────────────

/**
 * Hvad hver maaling forventes at vise, og hvor den SKAL kunne maerkes (ren data).
 * sign: forventet fortegn for ordre-minus-tvilling. scope: etapeklasser hvor ordren skal kunne maerkes.
 */
export const CHECKS = Object.freeze([
  { exp: "effort", arm: "grupetto", metric: "time", sign: 1, scope: ["hilly", "mountain"], what: "grupetto taber tid paa dagen" },
  { exp: "effort", arm: "save", metric: "time", sign: 1, scope: ["hilly", "mountain"], what: "spar taber lidt tid paa dagen" },
  { exp: "effort", arm: "protect", metric: "time", sign: -1, scope: ["hilly", "mountain"], what: "beskyt/koer offensivt (fri rolle) presser og vinder tid" },
  { exp: "effort", arm: "all_out", metric: "time", sign: -1, scope: ["hilly", "mountain"], what: "alt ud vinder tid paa dagen" },
  { exp: "effort", arm: "save", metric: "time_sign", sign: 1, scope: ["hilly", "mountain"], what: "spar: oftere bag end foran normal-tvillingen" },
  { exp: "effort", arm: "protect", metric: "time_sign", sign: -1, scope: ["hilly", "mountain"], what: "beskyt/koer offensivt: oftere foran end bag normal-tvillingen" },
  { exp: "effort", arm: "all_out", metric: "time_sign", sign: -1, scope: ["hilly", "mountain"], what: "alt ud: oftere foran end bag normal-tvillingen" },
  { exp: "effort", arm: "grupetto", metric: "load", sign: -1, scope: ["flat", "hilly", "mountain"], what: "grupetto koster mindre traethed" },
  { exp: "effort", arm: "save", metric: "load", sign: -1, scope: ["flat", "hilly", "mountain"], what: "spar koster mindre traethed" },
  { exp: "effort", arm: "protect", metric: "load", sign: 1, scope: ["flat", "hilly", "mountain"], what: "beskyt koster mere traethed" },
  { exp: "effort", arm: "all_out", metric: "load", sign: 1, scope: ["flat", "hilly", "mountain"], what: "alt ud koster mere traethed" },
  { exp: "break", arm: "try_break", metric: "attempt", sign: 1, scope: ["flat", "hilly", "mountain"], what: "Forsoeg udbrud giver flere forsoeg" },
  { exp: "break", arm: "try_break", metric: "in_break", sign: 1, scope: ["flat", "hilly", "mountain"], what: "Forsoeg udbrud giver flere dage i udbruddet" },
  { exp: "plan", arm: "final", metric: "time", sign: -1, scope: ["hilly", "mountain"], what: "plan: angreb fra de sidste km vinder tid mod spar hele dagen" },
  { exp: "plan", arm: "final", metric: "switch_fired", sign: 1, scope: ["flat", "hilly", "mountain"], what: "plan: skiftet ved de sidste km sker" },
  { exp: "plan", arm: "final", metric: "time_sign", sign: -1, scope: ["hilly", "mountain"], what: "plan: angreb fra de sidste km oftere foran end bag" },
  { exp: "plan", arm: "kom", metric: "time_sign", sign: -1, scope: ["hilly", "mountain"], what: "plan: angreb fra stigningens top oftere foran end bag" },
  { exp: "plan", arm: "dropped", metric: "time_sign", sign: 1, scope: ["mountain"], what: "plan: grupetto naar han er sat oftere bag end foran" },
  { exp: "plan", arm: "kom", metric: "time", sign: -1, scope: ["hilly", "mountain"], what: "plan: angreb fra toppen af sidste stigning vinder tid" },
  { exp: "plan", arm: "kom", metric: "switch_fired", sign: 1, scope: ["flat", "hilly", "mountain"], what: "plan: skiftet ved stigningens top sker" },
  { exp: "plan", arm: "dropped", metric: "time", sign: 1, scope: ["mountain"], what: "plan: grupetto naar han er sat ruller ind (taber tid)" },
  { exp: "plan", arm: "dropped", metric: "switch_fired", sign: 1, scope: ["mountain"], what: "plan: skiftet ved \"sat\" sker" },
  { exp: "train", arm: "sprint_train", metric: "captain_rank", sign: -1, scope: ["flat"], what: "sprinttog giver spurtkaptajnen en bedre placering" },
  { exp: "chase", arm: "chase_vs_let_go", metric: "break_won", sign: -1, scope: ["flat", "hilly", "mountain"], what: "jag giver faerre udbrudssejre end lad gaa" },
  { exp: "chase", arm: "chase_vs_neutral", metric: "break_won", sign: -1, scope: ["flat", "hilly", "mountain"], what: "jag giver faerre udbrudssejre end neutral" },
  { exp: "chase", arm: "chase_vs_let_go", metric: "break_lead", sign: -1, scope: ["flat", "hilly", "mountain"], what: "jag giver udbruddet et mindre forspring i maal end lad gaa" },
  { exp: "chase", arm: "chase_vs_neutral", metric: "break_lead", sign: -1, scope: ["flat", "hilly", "mountain"], what: "jag giver udbruddet et mindre forspring i maal end neutral" },
  { exp: "cocaptain", arm: "co_captain", metric: "co_gc_rank", sign: -1, scope: ["race"], what: "delt kaptajn ligger bedre i klassementet end som hjaelper" },
  { exp: "cocaptain", arm: "co_captain", metric: "co_stage_rank", sign: -1, scope: ["race"], what: "delt kaptajn (endagsloeb) placerer sig bedre end som hjaelper" },
  { exp: "cocaptain", arm: "co_captain", metric: "captain_gc_rank", sign: 1, scope: ["race"], what: "kaptajnen taber hoejst lidt (information, ikke gate)", info: true },
  { exp: "cocaptain", arm: "co_captain", metric: "captain_stage_rank", sign: 1, scope: ["race"], what: "kaptajnen taber hoejst lidt (information, ikke gate)", info: true },
]);

const armMatches = (check, rec) => (check.exp === "cocaptain" ? rec.arm.startsWith("co_captain") : rec.arm === check.arm);

/** Alle checks pr. gruppe + samlet, i scope og over alle klasser (ren). */
export function summarize(records) {
  const out = [];
  for (const check of CHECKS) {
    const xs = records.filter((r) => r.exp === check.exp && armMatches(check, r) && r.metric === check.metric);
    if (!xs.length) continue;
    const inScope = (r) => check.scope.includes(r.cls);
    const stat = (rows) => effectStats(rows.map((r) => r.dOn), rows.map((r) => r.dCtrl), check.sign);
    const byGroup = {};
    for (const g of GROUPS) {
      const rows = xs.filter((r) => r.group === g && inScope(r));
      if (rows.length) byGroup[g] = stat(rows);
    }
    const byClass = {};
    for (const c of ["flat", "hilly", "mountain", "race"]) {
      const rows = xs.filter((r) => r.cls === c);
      if (rows.length) byClass[c] = stat(rows);
    }
    const byLevel = {};
    for (const lv of [...Object.keys(LEVELS), "team"]) {
      const rows = xs.filter((r) => r.level === lv && inScope(r));
      if (rows.length) byLevel[lv] = stat(rows);
    }
    const scoped = stat(xs.filter(inScope));
    out.push({ ...check, scoped, byGroup, byClass, byLevel, all: stat(xs) });
  }
  return out;
}

/** Invarianter (skal holde i hver eneste maaling, ren). */
export function invariants(records) {
  const g = records.filter((r) => r.exp === "break" && r.metric === "attempt_invariant");
  return [{ id: "grupetto_try_break_never_attempts", n: g.length, violations: g.filter((r) => r.value !== 0).length }];
}

/** Ordrer der ikke virker eller ikke kan maerkes, hvor de burde (ren). */
export function findings(summary, inv, api) {
  const out = [];
  for (const s of summary) {
    if (s.info) continue;
    if (s.scoped.n === 0) continue;
    if (s.scoped.wrong) out.push({ kind: "wrong_direction", exp: s.exp, arm: s.arm, metric: s.metric, what: s.what });
    else if (!s.scoped.directionOk) out.push({ kind: "no_effect", exp: s.exp, arm: s.arm, metric: s.metric, what: s.what });
    else if (!s.scoped.beatsNoise) out.push({ kind: "not_noticeable", exp: s.exp, arm: s.arm, metric: s.metric, what: s.what });
    for (const [g, st] of Object.entries(s.byGroup)) {
      if (st.n >= 8 && st.wrong) out.push({ kind: "wrong_direction_in_group", group: g, exp: s.exp, arm: s.arm, metric: s.metric, what: s.what });
    }
  }
  for (const i of inv) if (i.violations > 0) out.push({ kind: "invariant_broken", id: i.id });
  for (const a of api ?? []) if (a.expectReject !== a.rejected) out.push({ kind: a.expectReject ? "api_accepts_blocked" : "api_rejects_valid", id: a.id, path: a.path });
  return out;
}

// ── Hovedloekken ────────────────────────────────────────────────────────────

export async function runTacticsEffects({ fromDir, caps = DEFAULT_GROUP_CAPS, seeds = 2, revision = REVISION, experiments = EXPERIMENTS, log = (s) => process.stderr.write(s) } = {}) {
  const api = experiments.includes("api") ? apiContradictionChecks() : null;
  const simExps = experiments.filter((e) => e !== "api");
  const records = [];
  const meta = [];
  if (simExps.length) {
    const v4 = await loadRaceEngineV4();
    const all = loadExport(fromDir);
    const donors = all.filter((r) => r.group !== "youth" && (r.data.entries?.length ?? 0) >= 100).map((r) => r.data);
    const picked = selectRaces(all, caps);
    for (const pr of picked) {
      const { data, filled } = fillField(pr.data, donors);
      const stages = sortedStages(data);
      const field = splitEntrants(data).entrants;
      const templates = pickTemplates(data.abilities.filter((a) => field.some((e) => e.rider_id === a.rider_id)));
      meta.push({ race: pr.id, group: pr.group, stages: stages.length, field: field.length, filled });
      for (let seed = 1; seed <= seeds; seed++) {
        for (const profile of stages) {
          const cls = stageClass(profile.profile_type);
          const rec = (r) => records.push({ ...r, group: pr.group, cls: r.cls ?? cls, race: pr.id, stage: profile.stage_number, seed });
          const ctx = { v4, data, stages, profile, field, templates, seed, revision, rec, experiments: simExps, group: pr.group };
          if (simExps.includes("effort") && cls !== "tt") runEffortDay(ctx);
          if (simExps.includes("break") || simExps.includes("plan")) runOrdersDay(ctx);
          if (simExps.includes("train")) runTrainDay(ctx);
          if (simExps.includes("chase")) runChaseDay(ctx);
        }
        if (simExps.includes("cocaptain")) {
          const rec = (r) => records.push({ ...r, group: pr.group, race: pr.id, stage: null, seed });
          runCoCaptainRace({ v4, data, stages, field, templates, seed, revision, rec, group: pr.group });
        }
      }
      log(".");
    }
    log("\n");
  }
  const summary = summarize(records);
  const inv = invariants(records);
  return { config: { revision, seeds, caps, experiments, noiseZ: NOISE_Z, minField: MIN_FIELD }, races: meta, summary, invariants: inv, api, findings: findings(summary, inv, api), records };
}

/** Flere koerslers resultater (fx én pr. gruppe) samlet til ét (ren). */
export function mergeResults(results) {
  const records = results.flatMap((r) => r.records ?? []);
  const api = results.find((r) => r.api)?.api ?? null;
  const summary = summarize(records);
  const inv = invariants(records);
  const config = { ...(results[0]?.config ?? {}), caps: Object.assign({}, ...results.map((r) => r.config?.caps ?? {})) };
  return { config, races: results.flatMap((r) => r.races ?? []), summary, invariants: inv, api, findings: findings(summary, inv, api), records };
}

const fmt = (st) => (st && st.n ? `${st.directionOk ? "ja" : "NEJ"} / ${st.beatsNoise ? "ja" : "nej"} (n ${st.n}, ${st.meanOn} mod ${st.meanCtrl}, z ${st.z})` : "-");

/** Privat markdown (tal). */
export function renderMarkdown(res, label) {
  const L = [`# #7266 taktik-ordrer under ${res.config.revision}: ${label}`, ""];
  const byGroup = {};
  for (const r of res.races) byGroup[r.group] = (byGroup[r.group] ?? 0) + 1;
  L.push(`${res.races.length} loeb (${Object.entries(byGroup).map(([g, n]) => `${g} ${n}`).join(", ")}), ${res.config.seeds} seeds, stoejgraense z >= ${res.config.noiseZ}. Felter fyldt op: ${res.races.filter((r) => r.filled > 0).length}.`, "");
  L.push("Celle: retning holder / kan maerkes (n, gennemsnit ordre-minus-tvilling mod kontrol-minus-tvilling, z).", "");
  L.push("## Samlet, hvor ordren skal kunne maerkes", "", "| ordre | maaling | forventet | scope | samlet |", "|---|---|---|---|---|");
  for (const s of res.summary) L.push(`| ${s.exp}/${s.arm} | ${s.metric} | ${s.what} | ${s.scope.join("+")} | ${fmt(s.scoped)} |`);
  L.push("", "## Pr. loebsgruppe (i scope)", "", `| ordre | maaling | ${GROUPS.join(" | ")} |`, `|---|---|${GROUPS.map(() => "---").join("|")}|`);
  for (const s of res.summary) L.push(`| ${s.exp}/${s.arm} | ${s.metric} | ${GROUPS.map((g) => fmt(s.byGroup[g])).join(" | ")} |`);
  L.push("", "## Pr. etapeklasse (alle grupper)", "", "| ordre | maaling | flad | kuperet | bjerg | loeb |", "|---|---|---|---|---|---|");
  for (const s of res.summary) L.push(`| ${s.exp}/${s.arm} | ${s.metric} | ${["flat", "hilly", "mountain", "race"].map((c) => fmt(s.byClass[c])).join(" | ")} |`);
  L.push("", "## Pr. rytterniveau (i scope, kun enkeltryttere)", "", "| ordre | maaling | midt | staerk | top |", "|---|---|---|---|---|");
  for (const s of res.summary) if (s.byLevel && !s.byLevel.team) L.push(`| ${s.exp}/${s.arm} | ${s.metric} | ${Object.keys(LEVELS).map((lv) => fmt(s.byLevel[lv])).join(" | ")} |`);
  L.push("", "## Invarianter", "");
  for (const i of res.invariants) L.push(`- ${i.id}: ${i.violations} brud i ${i.n} maalinger`);
  if (res.api) {
    L.push("", "## API: spaerrede modsaetninger", "", "| kombination | sti | forventet | resultat | fejlkode |", "|---|---|---|---|---|");
    for (const a of res.api) L.push(`| ${a.id} | ${a.path} | ${a.expectReject ? "afvis" : "tillad"} | ${a.rejected ? "afvist" : "TILLADT"} | ${a.error ?? ""} |`);
  }
  L.push("", "## Fund", "");
  if (!res.findings.length) L.push("Ingen.");
  for (const f of res.findings) L.push(`- ${f.kind}: ${f.id ?? `${f.exp}/${f.arm} ${f.metric}`}${f.group ? ` (${f.group})` : ""}${f.what ? ` - ${f.what}` : ""}${f.path ? ` [${f.path}]` : ""}`);
  return L.join("\n");
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  const arg = (name, fallback) => { const hit = process.argv.find((a) => a.startsWith(`--${name}=`)); return hit ? hit.slice(name.length + 3) : fallback; };
  const capsArg = arg("groups", null);
  const caps = capsArg ? Object.fromEntries(capsArg.split(",").map((kv) => { const [k, v] = kv.split(":"); return [k, Number(v)]; })) : DEFAULT_GROUP_CAPS;
  const fromDir = arg("from-dir", null);
  const experiments = arg("experiments", EXPERIMENTS.join(",")).split(",");
  const out = arg("out", null);
  const merge = arg("merge", null);
  if (merge && !out) throw new Error("--merge kraever --out (mappen med de enkelte koersler)");
  if (!merge && !fromDir && experiments.some((e) => e !== "api")) throw new Error("--from-dir=<eksport>/races kraeves");
  const res = merge
    ? mergeResults(merge.split(",").map((l) => JSON.parse(readFileSync(path.join(path.resolve(REPO_ROOT, out), `tactics-effects-${l}.json`), "utf8"))))
    : await runTacticsEffects({ fromDir, caps, seeds: Number(arg("seeds", "2")), revision: arg("revision", REVISION), experiments });
  const label = arg("label", "v3");
  const md = renderMarkdown(res, label);
  if (out) {
    const dir = path.resolve(REPO_ROOT, out);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, `tactics-effects-${label}.json`), JSON.stringify(res, null, 2));
    writeFileSync(path.join(dir, `tactics-effects-${label}.md`), md);
    console.error(`skrev ${path.join(dir, `tactics-effects-${label}.{json,md}`)}`);
  } else {
    console.log(md);
  }
}
