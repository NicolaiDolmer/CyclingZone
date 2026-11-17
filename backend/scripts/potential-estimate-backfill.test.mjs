// #7685: tændingens backfill af gemte potentiale-skøn. Tallene her er syntetiske
// testværdier, ikke kalibreringen eller XP-tallene (private, hard rule 17).
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  BACKFILL_TRIGGER, PUBLIC_VIEW_KEYS, evaluateEstimateGates, isPrivateOutDir, parseArgs, resolveBackfillConfig,
  runPotentialEstimateBackfill,
} from "./potential-estimate-backfill.mjs";
import { POTENTIAL_ESTIMATE_PARAMS_KEY, POTENTIAL_ESTIMATES_TABLE } from "../lib/potentialEstimateWriter.js";
import { runSundayPotentialEstimateSweep } from "../lib/sundayPotentialEstimateSweep.js";
import { createFakeSupabase } from "../lib/testUtils/fakeSupabase.js";
import { validateDevelopmentXpParams } from "../lib/developmentXp.ts";
import { expectedTopRating } from "../lib/developmentXpExpectedTop.ts";
import { VISIBLE_ABILITIES } from "../lib/abilityDerivation.js";
import { ageForSeason } from "../lib/riderSeasonAge.js";
import { publicEstimateView } from "../lib/potentialEstimate.js";

const PARAMS = Object.freeze({
  salt: "test",
  weights: { shared: 0.6, pair: 0.6, level: 0.53 },
  clip: 2,
  minU: 1,
  words: { sureAtOrBelow: 3, fairAtOrBelow: 6 },
  scout: { maxLooks: 3, defaultTier: 1, uByLooks: [8, 5, 3], tierFactor: [1, 0.9, 0.8, 0.7, 0.6] },
  own: { firstEstimateDates: 5, staffSpeedWeight: 0.5, steps: [{ fromDates: 0, u: 7 }, { fromDates: 12, u: 4 }, { fromDates: 20, u: 2 }] },
});

const XP_RAW = Object.freeze({
  price: { base: 10, exponent: 2 },
  potentialXp: [{ at: 1, value: 10 }, { at: 3, value: 30 }, { at: 6, value: 90 }],
  ageShare: {
    physical: [{ at: 28, value: 1 }, { at: 32, value: 0.5 }, { at: 36, value: 0.1 }],
    mental: [{ at: 32, value: 1 }, { at: 36, value: 0.5 }, { at: 40, value: 0.2 }],
  },
  offFocusShare: 0.1,
  raceOffFocusShare: 0.2,
  typeShare: { signatur: 1, sekundaer: 0.8, haandvaerk: 0.5, andenRolle: 0.3, svaghed: 0.1 },
});

// Mandag efter tændingen: backfill'en er ikke bundet til søndag.
const NOW = new Date("2026-11-09T10:00:00.000Z");
const SUNDAY = new Date("2026-11-08T13:30:00.000Z");

const ABILITIES = Object.fromEntries(VISIBLE_ABILITIES.map((a) => [a, 45]));
const rider = (id, teamId, extra = {}) => ({
  id, team_id: teamId, talent_ceiling: null, is_retired: false,
  potentiale: 4, birthdate: "2005-06-01", primary_type: "climber", secondary_type: "puncheur", ...extra,
});
const ticks = (riderId, teamId, n) => Array.from({ length: n }, (_, i) => ({
  rider_id: riderId, team_id: teamId, season_id: "s1", game_day: i + 1, tick_date: `2026-10-${String(i + 1).padStart(2, "0")}`,
}));

const client = ({ writes = "on", xp = "on", fromDate = "2026-11-08", params = PARAMS, xpParams = XP_RAW, ...tables } = {}) => createFakeSupabase({
  app_config: [
    { key: "potential_estimate_writes", value: writes },
    { key: "development_xp_model", value: xp },
    { key: "development_xp_from_date", value: fromDate },
  ],
  private_config: [
    ...(params ? [{ key: POTENTIAL_ESTIMATE_PARAMS_KEY, value: params }] : []),
    ...(xpParams ? [{ key: "development_xp_params", value: xpParams }] : []),
  ],
  seasons: [{ id: "s1", number: 1, status: "active" }],
  teams: [{ id: "t1", is_ai: false, is_bank: false }, { id: "t2", is_ai: false, is_bank: false }, { id: "ai", is_ai: true, is_bank: false }],
  riders: [rider("r1", "t1"), rider("r2", "t2"), rider("r3", "t1"), rider("r4", "ai")],
  rider_derived_abilities: ["r1", "r2", "r3", "r4"].map((id) => ({ rider_id: id, ...ABILITIES })),
  [POTENTIAL_ESTIMATES_TABLE]: [],
  team_staff: [],
  team_facilities: [],
  // t1 har scoutet r2; t2 har scoutet r1 og r3. r3 har kun 3 datoer på t1: ingen egen viden endnu.
  scout_actions: [
    { id: "a1", team_id: "t1", rider_id: "r2" },
    { id: "a2", team_id: "t2", rider_id: "r1" },
    { id: "a3", team_id: "t2", rider_id: "r3" },
  ],
  training_rider_ticks: [...ticks("r1", "t1", 6), ...ticks("r2", "t2", 25), ...ticks("r3", "t1", 3)],
  rider_training_scores: [],
  training_day_runs: [],
  ...tables,
});

const estimates = (sb) => sb.state[POTENTIAL_ESTIMATES_TABLE];
const quiet = { error: () => {}, warn: () => {}, log: () => {} };
const backfill = (sb, opts = {}) => runPotentialEstimateBackfill({ supabase: sb, now: NOW, log: quiet, ...opts });
const truth = () => expectedTopRating({
  id: "r1", abilities: ABILITIES, age: ageForSeason("2005-06-01", 1), potentiale: 4, primaryType: "climber", secondaryType: "puncheur",
}, validateDevelopmentXpParams(XP_RAW));

test("CLI: dry-run er default, og --out skal ligge i balance-internals", () => {
  assert.deepEqual(parseArgs([]), { apply: false, ownerGo: false, assumeXp: false, paramsFile: null, xpParamsFile: null, gatesFile: null, out: null });
  const args = parseArgs(["--apply", "--owner-go", "--out=../balance-internals/6110-potentiale/x", "--assume-xp"]);
  assert.equal(args.apply && args.ownerGo && args.assumeXp, true);
  assert.equal(isPrivateOutDir("../balance-internals/6110-potentiale/x"), true);
  assert.equal(isPrivateOutDir("docs/audits"), false);
  assert.equal(isPrivateOutDir(null), false);
});

test("dry-run skriver intet og regner alle ryttere på alle menneskehold", async () => {
  const sb = client();
  const report = await backfill(sb);
  assert.equal(report.ran, true);
  assert.equal(report.mode, "dry-run");
  assert.equal(report.truth, "expected_top");
  assert.equal(report.teams, 2, "AI-hold får intet skøn");
  // t1: r1 (egen, 6 datoer) + r2 (kig). t2: r2 (egen, 25 datoer) + r1 og r3 (kig). r3 lærer stadig på t1.
  assert.equal(report.written, 5);
  assert.equal(report.noKnowledge, 1);
  assert.equal(estimates(sb).length, 0);
});

test("dry-run før tænding: uden XP er det sande tal talent_ceiling, og det er tomt", async () => {
  const sb = client({ writes: "off", xp: "off" });
  const report = await backfill(sb);
  assert.equal(report.truth, "talent_ceiling");
  assert.equal(report.written, 0);
  assert.equal(estimates(sb).length, 0);
});

test("dry-run før tænding: --assume-xp regner med XP-tallene i private_config", async () => {
  const sb = client({ writes: "off", xp: "off" });
  const report = await backfill(sb, { assumeXp: true });
  assert.equal(report.truth, "expected_top");
  assert.equal(report.written, 5);
  assert.equal(estimates(sb).length, 0);
});

test("dry-run med private filer: filerne vinder, og ugyldige filer afvises", async () => {
  const sb = client({ writes: "off", xp: "off", params: null, xpParams: null });
  assert.equal((await backfill(sb)).reason, "params_missing");
  assert.equal((await backfill(sb, { params: PARAMS })).truth, "talent_ceiling");
  assert.equal((await backfill(sb, { params: PARAMS, assumeXp: true })).reason, "xp_params_missing");
  const report = await backfill(sb, { params: PARAMS, developmentXp: XP_RAW });
  assert.equal(report.written, 5);
  assert.equal((await backfill(sb, { params: { ...PARAMS, clip: 0 } })).reason, "params_invalid");
  assert.equal((await backfill(sb, { params: PARAMS, developmentXp: { price: {} } })).reason, "xp_params_invalid");
});

test("apply kræver samme tilstand som søndagskørslen, med XP gældende for datoen", async () => {
  assert.equal((await backfill(client({ writes: "off" }), { apply: true })).reason, "flag_off");
  assert.equal((await backfill(client({ params: null }), { apply: true })).reason, "params_missing");
  assert.equal((await backfill(client({ xp: "off" }), { apply: true })).reason, "xp_not_live");
  assert.equal((await backfill(client({ fromDate: "2026-11-10" }), { apply: true })).reason, "xp_not_live");
  assert.equal((await backfill(client({ xpParams: null }), { apply: true })).reason, "xp_not_live");
  for (const extra of [{ params: PARAMS }, { developmentXp: XP_RAW }, { assumeXp: true }]) {
    const sb = client();
    assert.equal((await backfill(sb, { apply: true, ...extra })).reason, "private_files_not_allowed_with_apply");
    assert.equal(estimates(sb).length, 0);
  }
});

test("apply skriver de manglende skøn som backfill over forventet topniveau, og er idempotent", async () => {
  const sb = client();
  const first = await backfill(sb, { apply: true });
  assert.equal(first.ran, true);
  assert.equal(first.written, 5);
  assert.equal(estimates(sb).length, 5);
  assert.ok(estimates(sb).every((row) => row.write_reason === BACKFILL_TRIGGER && row.computed_at === NOW.toISOString()));
  assert.equal(estimates(sb).find((row) => row.rider_id === "r1" && row.team_id === "t1").ceiling_at_write, truth());

  const snapshot = JSON.stringify(estimates(sb));
  const second = await backfill(sb, { apply: true, now: new Date("2026-11-09T11:00:00.000Z") });
  assert.equal(second.written, 0);
  assert.equal(second.kept, 5);
  assert.equal(JSON.stringify(estimates(sb)), snapshot);
});

test("apply overskriver aldrig en gemt række", async () => {
  const stored = {
    rider_id: "r1", team_id: "t1", value: 11, certainty: "unsure", uncertainty: 7, knowledge_key: "own0",
    ceiling_at_write: 12, params_version: "old", write_reason: "new_knowledge",
    previous_value: null, previous_certainty: null, changed_at: null, computed_at: "2026-11-01T00:00:00.000Z",
  };
  const sb = client({ [POTENTIAL_ESTIMATES_TABLE]: [{ ...stored }] });
  const report = await backfill(sb, { apply: true });
  assert.equal(report.written, 4);
  assert.deepEqual(estimates(sb).find((row) => row.rider_id === "r1" && row.team_id === "t1"), stored);
});

test("backfill'en skriver de samme tal og ord som søndagskørslen ville", async () => {
  const viaBackfill = client();
  await backfill(viaBackfill, { apply: true });
  const viaSunday = client({ fromDate: "2026-11-08" });
  await runSundayPotentialEstimateSweep({ supabase: viaSunday, now: SUNDAY, state: { cleanRunDate: null } });
  const key = (row) => `${row.rider_id}:${row.team_id}`;
  const pick = (row) => [row.value, row.certainty, row.knowledge_key, row.ceiling_at_write, row.params_version];
  const sunday = new Map(estimates(viaSunday).map((row) => [key(row), pick(row)]));
  assert.equal(sunday.size, 5);
  for (const row of estimates(viaBackfill)) assert.deepEqual(pick(row), sunday.get(key(row)), key(row));
});

test("ét hold der fejler, stopper ikke de andre, og en ny kørsel tager det igen", async () => {
  const sb = client();
  const from = sb.from;
  sb.from = (table) => {
    const api = from(table);
    if (table !== POTENTIAL_ESTIMATES_TABLE) return api;
    return { ...api, upsert: (rows, opts) => (rows[0].team_id === "t1" ? { select: async () => ({ error: { message: "boom" } }) } : api.upsert(rows, opts)) };
  };
  const first = await backfill(sb, { apply: true });
  sb.from = from;
  assert.equal(first.failedTeams, 1);
  assert.match(first.firstError, /boom/);
  assert.deepEqual([...new Set(estimates(sb).map((row) => row.team_id))], ["t2"]);
  const second = await backfill(sb, { apply: true });
  assert.equal(second.failedTeams, 0);
  assert.equal(estimates(sb).length, 5);
});

test("gaterne i dry-run: H2-H4 grønne på de planlagte rækker, H5 dækket af læse-testene", async () => {
  const report = await backfill(client(), { withGates: true });
  assert.equal(report.rows.length, 5);
  const { gates } = report;
  assert.equal(gates.h1.status, "no_limit", "uden private grænser måles der, men intet dømmes");
  assert.equal(gates.h2.status, "green");
  assert.equal(gates.h2.writes, 0);
  assert.equal(gates.h3.status, "green");
  assert.equal(gates.h4.status, "green");
  assert.equal(gates.h5.status, "covered_by_tests");
  assert.equal(gates.h6.status, "no_limit");
  // Apply måler ikke gater og returnerer ingen rækker.
  const applied = await backfill(client(), { apply: true, withGates: true });
  assert.equal(applied.gates, undefined);
  assert.equal(applied.rows, undefined);
});

test("evaluateEstimateGates: private grænser dømmer, og en søndag der ville skrive er rød", () => {
  const rows = [
    { rider_id: "r1", team_id: "t1", value: 70, certainty: "sure", ceiling_at_write: 72 },
    { rider_id: "r1", team_id: "t2", value: 66, certainty: "fair", ceiling_at_write: 72 },
    { rider_id: "r2", team_id: "t1", value: 50, certainty: "unsure", ceiling_at_write: 58 },
  ];
  const strict = evaluateEstimateGates(rows, { params: PARAMS, limits: { h1: { sure: { p90Max: 1 } } } });
  assert.equal(strict.h1.status, "red");
  assert.equal(strict.h1.byWord.sure.status, "red");
  assert.equal(strict.h1.byWord.fair.status, "no_limit");
  const loose = evaluateEstimateGates(rows, { params: PARAMS, limits: { h1: { sure: { p90Max: 3 } } } });
  assert.equal(loose.h1.status, "green");
  assert.equal(evaluateEstimateGates(rows, { params: PARAMS, h2Writes: 1 }).h2.status, "red");
  // Sammenlægning: r1 har to holds skøn; snittet er 68 mod det bedste enkelt-skøns fejl 2.
  const pooled = evaluateEstimateGates(rows, { params: PARAMS, limits: { h6: { poolMinRatio: 1 } } });
  assert.equal(pooled.h6.pooled.n, 1);
  assert.equal(pooled.h6.poolRatio, 2);
  assert.equal(pooled.h6.status, "green");
  assert.equal(evaluateEstimateGates(rows, { params: PARAMS, limits: { h6: { poolMinRatio: 3 } } }).h6.status, "red");
  assert.equal(evaluateEstimateGates([], { params: PARAMS }).h3.status, "green");
});

test("H4: den offentlige visning har kun de tilladte felter", () => {
  const row = { value: 70, certainty: "sure", uncertainty: 1.2, knowledge_key: "s3t5", ceiling_at_write: 72, previous_value: 68, previous_certainty: "fair", changed_at: "x" };
  const view = publicEstimateView(row, { currentRating: 1 });
  assert.ok(Object.keys(view).every((key) => PUBLIC_VIEW_KEYS.includes(key)));
  assert.ok(!JSON.stringify(view).includes("72"), "det sande tal forlader aldrig serveren");
});

test("resolveBackfillConfig: dry-run uden XP og uden --assume-xp bruger dagens sande tal", async () => {
  const resolved = await resolveBackfillConfig(client({ xp: "off" }), { now: NOW, log: quiet });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.truth, "talent_ceiling");
  assert.equal(resolved.config.developmentXp, undefined);
  assert.ok(resolved.config.truthCache instanceof Map);
});
