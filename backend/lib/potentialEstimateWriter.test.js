// #7685: skrivningen af gemte potentiale-skøn. Tallene i PARAMS er syntetiske
// testværdier, ikke kalibreringen (den er privat, hard rule 17).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { knowledgeLevel, planEstimateWrite } from "./potentialEstimate.js";
import { PRIVATE_CONFIG_KEYS, privateConfigHash, validatePrivateConfigValue } from "./privateConfig.ts";
import {
  POTENTIAL_ESTIMATE_PARAMS_KEY, POTENTIAL_ESTIMATES_TABLE, loadEstimateTeamIds, loadEstimateWriteConfig,
  planTeamEstimates, recordScoutLooks, scoutKnowledgeForWrite, writeTeamEstimates,
} from "./potentialEstimateWriter.js";
import { completeTargetAssignment, lazyCompleteDueTargetAssignments } from "./scoutTargetMaturation.js";
import { completeDueMissionAssignments } from "./scoutMissionMaturation.js";
import { createFakeSupabase } from "./testUtils/fakeSupabase.js";

const PARAMS = Object.freeze({
  salt: "test",
  weights: { shared: 0.6, pair: 0.6, level: 0.53 },
  clip: 2,
  minU: 1,
  words: { sureAtOrBelow: 3, fairAtOrBelow: 6 },
  scout: { maxLooks: 3, defaultTier: 1, uByLooks: [8, 5, 3], tierFactor: [1, 0.9, 0.8, 0.7, 0.6] },
  own: { firstEstimateDates: 5, staffSpeedWeight: 0.5, steps: [{ fromDates: 0, u: 7 }, { fromDates: 12, u: 4 }, { fromDates: 20, u: 2 }] },
});
const NOW = "2026-11-08T13:30:00.000Z";

const client = ({ flag = "on", params = PARAMS, ...tables } = {}) => createFakeSupabase({
  app_config: [{ key: "potential_estimate_writes", value: flag }],
  private_config: params ? [{ key: POTENTIAL_ESTIMATE_PARAMS_KEY, value: params }] : [],
  [POTENTIAL_ESTIMATES_TABLE]: [],
  team_staff: [],
  team_facilities: [],
  scout_actions: [],
  training_rider_ticks: [],
  rider_training_scores: [],
  training_day_runs: [],
  ...tables,
});

const planOne = ({ rider, stored = null, looks = 0, dates = 0, scoutTier = null, trigger, teamId = "t1", staffSpeed = 0 }) => planTeamEstimates({
  teamId,
  riders: [rider],
  storedByRider: new Map(stored ? [[rider.id, stored]] : []),
  looksByRider: new Map([[rider.id, looks]]),
  datesByRider: new Map([[rider.id, dates]]),
  staffSpeed,
  scoutTier,
  trigger,
  params: PARAMS,
  paramsVersion: "v1",
  now: NOW,
});

const foreign = { id: "r1", team_id: "t2", talent_ceiling: 70 };
const own = { id: "r1", team_id: "t1", talent_ceiling: 70 };

// ── Scout-viden ────────────────────────────────────────────────────────────

test("nøglen fra potentialEstimate.js kan læses tilbage til samme vidensniveau", () => {
  // Writeren læser scoutens niveau ud af nøglen. Ændres formatet i lib'en, skal det
  // falde her og ikke tavst gøre alle gemte niveauer ukendte.
  const level = knowledgeLevel({ own: false, looks: 2, bestScoutTier: 4 }, PARAMS);
  const back = scoutKnowledgeForWrite({ stored: { knowledge_key: level.key }, looks: 2, scoutTier: 1, maxLooks: 3 });
  assert.deepEqual(back, { looks: 2, bestScoutTier: 4 });
  assert.equal(knowledgeLevel({ own: false, ...back }, PARAMS).key, level.key);
});

test("et kig bruger holdets nuværende scout", () => {
  assert.deepEqual(scoutKnowledgeForWrite({ looks: 1, scoutTier: 4, freshLook: true, maxLooks: 3 }), { looks: 1, bestScoutTier: 4 });
});

test("et kig med en svagere scout sænker ikke det bedste niveau", () => {
  const stored = { knowledge_key: "s1t5" };
  assert.deepEqual(scoutKnowledgeForWrite({ stored, looks: 2, scoutTier: 2, freshLook: true, maxLooks: 3 }), { looks: 2, bestScoutTier: 5 });
});

test("uden scout er kigget et standardscout-kig", () => {
  assert.deepEqual(scoutKnowledgeForWrite({ looks: 1, scoutTier: null, freshLook: true, maxLooks: 3 }), { looks: 1, bestScoutTier: null });
});

test("uden nyt kig gælder den gemte nøgle, også når holdet har fået en bedre scout", () => {
  assert.deepEqual(scoutKnowledgeForWrite({ stored: { knowledge_key: "s2t2" }, looks: 2, scoutTier: 5, maxLooks: 3 }), { looks: 2, bestScoutTier: 2 });
});

test("flere kig end nøglen kender: den tabte skrivning indhentes", () => {
  assert.deepEqual(scoutKnowledgeForWrite({ stored: { knowledge_key: "s1t2" }, looks: 2, scoutTier: 3, maxLooks: 3 }), { looks: 2, bestScoutTier: 3 });
});

test("kig ud over loftet er ikke en tabt skrivning", () => {
  assert.deepEqual(scoutKnowledgeForWrite({ stored: { knowledge_key: "s3t2" }, looks: 7, scoutTier: 5, maxLooks: 3 }), { looks: 3, bestScoutTier: 2 });
});

test("egen viden der har overhalet kiggene, trækker ikke kiggene ind igen", () => {
  assert.deepEqual(scoutKnowledgeForWrite({ stored: { knowledge_key: "own1" }, looks: 2, scoutTier: 5, maxLooks: 3 }), { looks: 0, bestScoutTier: null });
});

// ── Planlægning ────────────────────────────────────────────────────────────

test("rytter uden talent_ceiling springes over", () => {
  const { rows, counts } = planOne({ rider: { ...own, talent_ceiling: null }, dates: 40, trigger: "sunday" });
  assert.deepEqual(rows, []);
  assert.equal(counts.noCeiling, 1);
});

test("fremmed rytter uden kig og egen rytter under grænsen får intet skøn", () => {
  assert.equal(planOne({ rider: foreign, trigger: "sunday" }).counts.noKnowledge, 1);
  assert.equal(planOne({ rider: own, dates: 4, trigger: "sunday" }).counts.noKnowledge, 1);
});

test("egen rytter får sit første skøn ved grænsen", () => {
  const { rows } = planOne({ rider: own, dates: 5, trigger: "sunday" });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].write_reason, "sunday");
  assert.equal(rows[0].knowledge_key, "own0");
  assert.equal(rows[0].ceiling_at_write, 70);
  assert.equal(rows[0].team_id, "t1");
});

test("trænerstaben fremskynder viden om egne ryttere", () => {
  assert.equal(planOne({ rider: own, dates: 10, trigger: "sunday" }).rows[0].knowledge_key, "own0");
  assert.equal(planOne({ rider: own, dates: 10, staffSpeed: 1, trigger: "sunday" }).rows[0].knowledge_key, "own1");
});

test("søndag: et kig uden række er en indhentning, ikke en søndagsopdatering", () => {
  const { rows } = planOne({ rider: foreign, looks: 1, scoutTier: 3, trigger: "sunday" });
  assert.equal(rows[0].write_reason, "backfill");
  assert.equal(rows[0].knowledge_key, "s1t3");
});

const storedFor = (args) => planOne(args).rows[0];

test("søndag: en bedre scout flytter ikke tallet på en rytter han aldrig har set (H2)", () => {
  const stored = storedFor({ rider: foreign, looks: 2, scoutTier: 1, trigger: "new_knowledge" });
  const { rows, counts } = planOne({ rider: foreign, stored, looks: 2, scoutTier: 5, trigger: "sunday" });
  assert.deepEqual(rows, []);
  assert.equal(counts.kept, 1);
});

test("søndag: fremmed rytter skrives kun, når loftet har flyttet sig", () => {
  const stored = storedFor({ rider: foreign, looks: 1, scoutTier: 2, trigger: "new_knowledge" });
  assert.equal(planOne({ rider: foreign, stored, looks: 1, scoutTier: 2, trigger: "sunday" }).counts.kept, 1);
  const moved = planOne({ rider: { ...foreign, talent_ceiling: 80 }, stored, looks: 1, scoutTier: 2, trigger: "sunday" }).rows[0];
  assert.equal(moved.ceiling_at_write, 80);
  assert.equal(moved.knowledge_key, stored.knowledge_key);
  assert.equal(moved.previous_value, stored.value);
});

test("søndag: flere afregnede datoer gør skønnet mere sikkert, og mindre viden flytter intet (H3)", () => {
  const stored = storedFor({ rider: own, dates: 12, trigger: "sunday" });
  assert.equal(stored.knowledge_key, "own1");
  assert.equal(planOne({ rider: own, stored, dates: 20, trigger: "sunday" }).rows[0].knowledge_key, "own2");
  assert.equal(planOne({ rider: own, stored, dates: 6, trigger: "sunday" }).counts.kept, 1);
});

test("rytter der forlod holdet, beholder holdets viden og følger loftet", () => {
  const stored = storedFor({ rider: own, dates: 12, trigger: "sunday" });
  const moved = planOne({ rider: { ...foreign, talent_ceiling: 64 }, stored, trigger: "sunday" }).rows[0];
  assert.equal(moved.knowledge_key, stored.knowledge_key);
  assert.equal(moved.ceiling_at_write, 64);
});

test("nyt kig: skrives ved nyt niveau og står stille uden", () => {
  const first = storedFor({ rider: foreign, looks: 1, scoutTier: 3, trigger: "new_knowledge" });
  assert.equal(first.write_reason, "new_knowledge");
  assert.equal(planOne({ rider: foreign, stored: first, looks: 1, scoutTier: 3, trigger: "new_knowledge" }).counts.kept, 1);
  assert.equal(planOne({ rider: foreign, stored: first, looks: 2, scoutTier: 3, trigger: "new_knowledge" }).rows[0].knowledge_key, "s2t3");
});

test("holdskifte: viden fra før skiftet følger med, og egen træning overtager (spec 3.3)", () => {
  const stored = storedFor({ rider: foreign, looks: 2, scoutTier: 3, trigger: "new_knowledge" });
  assert.equal(planOne({ rider: own, stored, looks: 2, scoutTier: 5, dates: 0, trigger: "team_change" }).counts.kept, 1);
  assert.equal(planOne({ rider: own, stored, looks: 2, dates: 25, trigger: "sunday" }).rows[0].knowledge_key, "own2");
});

test("rækken er præcis det planEstimateWrite giver", () => {
  const { rows } = planOne({ rider: foreign, looks: 1, scoutTier: 3, trigger: "new_knowledge" });
  const plan = planEstimateWrite({
    stored: null, truePot: 70, riderId: "r1", teamId: "t1",
    knowledge: { own: false, trainingDates: 0, staffSpeed: 0, looks: 1, bestScoutTier: 3 },
    trigger: "new_knowledge", paramsVersion: "v1", now: NOW,
  }, PARAMS);
  assert.deepEqual(rows[0], plan.row);
});

// ── Kalibreringen ──────────────────────────────────────────────────────────

test("private_config-nøglen validerer med validateParams og er privat", () => {
  const spec = PRIVATE_CONFIG_KEYS.potential_estimate_params;
  assert.equal(spec.private, true);
  assert.equal(validatePrivateConfigValue(spec.parse, PARAMS).ok, true);
  assert.equal(validatePrivateConfigValue(spec.parse, { ...PARAMS, minU: 0 }).ok, false);
  assert.equal(validatePrivateConfigValue(spec.parse, "x").ok, false);
});

test("konfigurationen: flag slukket, kalibrering mangler eller er ugyldig = ingen skrivning", async () => {
  assert.deepEqual(await loadEstimateWriteConfig(client({ flag: "off" })), { enabled: false, reason: "flag_off" });
  assert.deepEqual(await loadEstimateWriteConfig(client({ params: null })), { enabled: false, reason: "params_missing" });
  const warned = [];
  const original = console.warn;
  console.warn = (msg) => warned.push(msg);
  try {
    assert.deepEqual(await loadEstimateWriteConfig(client({ params: { salt: "x" } })), { enabled: false, reason: "params_missing" });
  } finally {
    console.warn = original;
  }
  assert.equal(warned.some((msg) => msg.includes("0.6")), false, "advarslen må ikke indeholde værdier");
});

test("konfigurationen: versionen er en hash, ikke tallene", async () => {
  const config = await loadEstimateWriteConfig(client());
  assert.equal(config.enabled, true);
  assert.equal(config.paramsVersion, privateConfigHash(PARAMS));
});

test("kun menneskehold får skøn", async () => {
  const sb = client({ teams: [{ id: "t1", is_ai: false, is_bank: false }, { id: "t2", is_ai: true, is_bank: false }, { id: "t3", is_ai: false, is_bank: true }] });
  assert.deepEqual(await loadEstimateTeamIds(sb), ["t1"]);
});

// ── recordScoutLooks ───────────────────────────────────────────────────────

const lookState = () => ({
  riders: [{ id: "r1", team_id: "t2", talent_ceiling: 70, is_retired: false }],
  scout_actions: [{ id: "a1", team_id: "t1", rider_id: "r1" }],
  team_staff: [{ team_id: "t1", role: "scouting", status: "active", tier: 2 }, { team_id: "t1", role: "scouting", status: "active", tier: 4 }, { team_id: "t1", role: "training", status: "active", tier: 5 }],
});

test("kig med flaget slukket læser ingen rytter og skriver intet", async () => {
  const sb = client({ ...lookState(), flag: "off" });
  const tables = [];
  const from = sb.from;
  sb.from = (table) => { tables.push(table); return from(table); };
  assert.deepEqual(await recordScoutLooks({ supabase: sb, teamId: "t1", riderIds: ["r1"], now: new Date(NOW) }), { skipped: "flag_off" });
  assert.deepEqual([...new Set(tables)], ["app_config"]);
  assert.equal(sb.state[POTENTIAL_ESTIMATES_TABLE].length, 0);
});

test("kig uden kalibrering skriver intet", async () => {
  const sb = client({ ...lookState(), params: null });
  assert.deepEqual(await recordScoutLooks({ supabase: sb, teamId: "t1", riderIds: ["r1"], now: new Date(NOW) }), { skipped: "params_missing" });
  assert.equal(sb.state[POTENTIAL_ESTIMATES_TABLE].length, 0);
});

test("kig skriver skønnet med holdets bedste aktive scout, og gentagelse står stille", async () => {
  const sb = client(lookState());
  await recordScoutLooks({ supabase: sb, teamId: "t1", riderIds: ["r1"], now: new Date(NOW) });
  const [row] = sb.state[POTENTIAL_ESTIMATES_TABLE];
  assert.equal(row.knowledge_key, "s1t4");
  assert.equal(row.write_reason, "new_knowledge");
  assert.equal(row.params_version, privateConfigHash(PARAMS));

  await recordScoutLooks({ supabase: sb, teamId: "t1", riderIds: ["r1"], now: new Date("2026-11-09T10:00:00.000Z") });
  assert.equal(sb.state[POTENTIAL_ESTIMATES_TABLE].length, 1);
  assert.equal(sb.state[POTENTIAL_ESTIMATES_TABLE][0].computed_at, NOW);
});

test("kig på rytter uden talent_ceiling skriver intet", async () => {
  const state = lookState();
  state.riders[0].talent_ceiling = null;
  const sb = client(state);
  await recordScoutLooks({ supabase: sb, teamId: "t1", riderIds: ["r1"], now: new Date(NOW) });
  assert.equal(sb.state[POTENTIAL_ESTIMATES_TABLE].length, 0);
});

test("pensioneret rytter skrives ikke", async () => {
  const state = lookState();
  state.riders[0].is_retired = true;
  const sb = client(state);
  await recordScoutLooks({ supabase: sb, teamId: "t1", riderIds: ["r1"], now: new Date(NOW) });
  assert.equal(sb.state[POTENTIAL_ESTIMATES_TABLE].length, 0);
});

test("en fejl i skrivningen kaster aldrig: kigget er allerede betalt", async () => {
  const sb = createFakeSupabase({
    app_config: [{ key: "potential_estimate_writes", value: "on" }],
    private_config: [{ key: POTENTIAL_ESTIMATE_PARAMS_KEY, value: PARAMS }],
    ...lookState(),
  }, { errors: { [POTENTIAL_ESTIMATES_TABLE]: { upsert: "boom" } } });
  const original = console.error;
  console.error = () => {};
  try {
    assert.deepEqual(await recordScoutLooks({ supabase: sb, teamId: "t1", riderIds: ["r1"], now: new Date(NOW) }), { failed: true });
  } finally {
    console.error = original;
  }
});

// ── To skrivninger om samme par ────────────────────────────────────────────

const CONFIG = { params: PARAMS, paramsVersion: "v1" };
const FOREIGN_RIDER = { id: "r1", team_id: "t2", talent_ceiling: 70, is_retired: false };
const storedRow = (knowledgeKey, overrides = {}) => ({
  rider_id: "r1", team_id: "t1", value: 66, certainty: "unsure", uncertainty: 5.6, knowledge_key: knowledgeKey,
  ceiling_at_write: 70, params_version: "v1", write_reason: "new_knowledge",
  previous_value: null, previous_certainty: null, changed_at: null, computed_at: "2026-11-01T10:00:00.000Z", ...overrides,
});

// Lader en anden skrivning lande lige før denne kørsels første skrivning.
function beforeFirstWrite(sb, action, otherWrite) {
  const from = sb.from;
  let done = false;
  sb.from = (table) => {
    const api = from(table);
    if (table !== POTENTIAL_ESTIMATES_TABLE) return api;
    return { ...api, [action]: (...args) => {
      if (!done) { done = true; otherWrite(); }
      return api[action](...args);
    } };
  };
}

const twoLooks = () => [{ id: "a1", team_id: "t1", rider_id: "r1" }, { id: "a2", team_id: "t1", rider_id: "r1" }];
const writeLook = (sb) => writeTeamEstimates({
  supabase: sb, teamId: "t1", riders: [FOREIGN_RIDER], trigger: "new_knowledge", config: CONFIG, now: new Date(NOW),
});

test("en stærkere viden, der lander undervejs, overskrives ikke", async () => {
  const sb = client({ ...lookState(), scout_actions: twoLooks(), [POTENTIAL_ESTIMATES_TABLE]: [storedRow("s1t4")] });
  beforeFirstWrite(sb, "update", () => Object.assign(sb.state[POTENTIAL_ESTIMATES_TABLE][0], { knowledge_key: "s3t4", uncertainty: 2.1, value: 71 }));
  const counts = await writeLook(sb);
  const [row] = sb.state[POTENTIAL_ESTIMATES_TABLE];
  assert.equal(row.knowledge_key, "s3t4");
  assert.equal(row.value, 71);
  assert.equal(row.previous_value, null);
  assert.equal(counts.written, 0);
  assert.equal(counts.kept, 1);
});

test("et kig, der taber kapløbet, læses igen og skrives oven på den nye række", async () => {
  const sb = client({ ...lookState(), scout_actions: twoLooks(), [POTENTIAL_ESTIMATES_TABLE]: [storedRow("s1t4")] });
  beforeFirstWrite(sb, "update", () => Object.assign(sb.state[POTENTIAL_ESTIMATES_TABLE][0], { ceiling_at_write: 69 }));
  const counts = await writeLook(sb);
  const [row] = sb.state[POTENTIAL_ESTIMATES_TABLE];
  assert.equal(row.knowledge_key, "s2t4");
  assert.equal(row.ceiling_at_write, 70);
  assert.equal(counts.written, 1);
});

test("to første skrivninger: den første række står, og taberen læser den igen", async () => {
  const sb = client(lookState());
  beforeFirstWrite(sb, "upsert", () => sb.state[POTENTIAL_ESTIMATES_TABLE].push(storedRow("s2t4", { uncertainty: 3.5 })));
  const counts = await writeLook(sb);
  assert.equal(sb.state[POTENTIAL_ESTIMATES_TABLE].length, 1);
  assert.equal(sb.state[POTENTIAL_ESTIMATES_TABLE][0].knowledge_key, "s2t4");
  assert.equal(counts.written, 0);
  assert.equal(counts.kept, 1);
});

// ── De tre steder der indsætter scout_actions ──────────────────────────────

test("target: lazy-stien skriver skønnet med det injicerede ur", async () => {
  const sb = client({
    ...lookState(),
    scout_actions: [],
    scout_assignments: [{
      id: "as1", team_id: "t1", rider_id: "r1", kind: "target", status: "active", target_level: 1, season_id: null,
      created_at: "2026-11-01T00:00:00.000Z",
    }],
  });
  const result = await lazyCompleteDueTargetAssignments({ supabase: sb, teamId: "t1", now: new Date(NOW), notify: async () => {} });
  assert.equal(result.completed, 1);
  assert.equal(sb.state[POTENTIAL_ESTIMATES_TABLE][0].computed_at, NOW);
});

test("target: sweep-stien skriver skønnet med det injicerede ur", async () => {
  const sb = client({ ...lookState(), scout_actions: [], scout_assignments: [{ id: "as1", status: "active" }] });
  const assignment = { id: "as1", team_id: "t1", rider_id: "r1", target_level: 1, season_id: null };
  await completeTargetAssignment({ supabase: sb, assignment, notify: async () => {}, now: new Date(NOW) });
  assert.equal(sb.state[POTENTIAL_ESTIMATES_TABLE][0].computed_at, NOW);
  assert.equal(sb.state.scout_assignments[0].completed_at, NOW);
});

test("target: et fuldført kig skriver skønnet, flere niveauer i ét hug giver én række", async () => {
  const sb = client({ ...lookState(), scout_actions: [], scout_assignments: [{ id: "as1", status: "active" }] });
  const assignment = { id: "as1", team_id: "t1", rider_id: "r1", target_level: 2, season_id: null };
  await completeTargetAssignment({ supabase: sb, assignment, notify: async () => {}, now: new Date(NOW) });
  assert.equal(sb.state.scout_actions.length, 2);
  assert.equal(sb.state[POTENTIAL_ESTIMATES_TABLE].length, 1);
  assert.equal(sb.state[POTENTIAL_ESTIMATES_TABLE][0].knowledge_key, "s2t4");
});

test("target: uden nyt kig skrives intet", async () => {
  const sb = client({ ...lookState(), scout_assignments: [{ id: "as1", status: "active" }] });
  const assignment = { id: "as1", team_id: "t1", rider_id: "r1", target_level: 1, season_id: null };
  await completeTargetAssignment({ supabase: sb, assignment, notify: async () => {}, now: new Date(NOW) });
  assert.equal(sb.state[POTENTIAL_ESTIMATES_TABLE].length, 0);
});

test("mission: hele shortlisten får et skøn", async () => {
  const candidates = ["r1", "r2", "r3"].map((id) => ({
    id, potentiale: 4, divisionId: "div-1", country: "DK", age: 22, isNmEligible: true, primaryType: null, ownerTeamId: null,
  }));
  const sb = client({
    ...lookState(),
    scout_actions: [],
    riders: candidates.map(({ id }) => ({ id, team_id: null, talent_ceiling: 70, is_retired: false })),
    seasons: [{ id: "s1", number: 5, status: "active" }],
    scout_assignments: [{
      id: "m1", team_id: "t1", kind: "mission", status: "active", season_id: "s1",
      created_at: "2026-11-01T00:00:00.000Z", mission_criteria: { scope: "division", value: "div-1" },
    }],
  });
  await completeDueMissionAssignments({
    supabase: sb,
    now: new Date(NOW),
    loadCandidates: async () => candidates,
    getScout: async () => ({ overall: 60, roleSkills: { evaluation: 60, reach: 60 } }),
    loadAlreadyScoutedRiderIds: async () => new Set(),
    notify: async () => {},
    hydrateVisibility: async (_sb, list) => list,
  });
  const shortlisted = sb.state.scout_actions.map((a) => a.rider_id).sort();
  assert.ok(shortlisted.length > 0, "testen skal ramme en shortlist");
  assert.deepEqual(sb.state[POTENTIAL_ESTIMATES_TABLE].map((r) => r.rider_id).sort(), shortlisted);
});

test("slots-ruten skriver skønnet efter indsættelsen", () => {
  const src = readFileSync(new URL("../routes/api.js", import.meta.url), "utf8");
  const insert = src.indexOf('.insert({ team_id: req.team.id, rider_id: riderId, season_id: activeSeasonId })');
  assert.ok(insert > 0);
  const hook = src.indexOf("await recordScoutLooks({ supabase, teamId: req.team.id, riderIds: [riderId] })", insert);
  assert.ok(hook > insert && hook - insert < 300, "recordScoutLooks skal stå lige efter scout_actions-indsættelsen");
});
