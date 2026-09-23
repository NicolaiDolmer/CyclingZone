import test from "node:test";
import assert from "node:assert/strict";

import { runBalanceDriftWatch, fetchV4DayInputs } from "./balanceDriftWatch.js";
import { BALANCE_DRIFT_BANDS, V4_SERIES_METRICS } from "./balanceDriftMetrics.js";
import { REGISTRY_ABILITY_KEYS } from "./abilityRegistry.js";
import { scoreDominance } from "../scripts/lib/headToHeadAnchors.js";
import { RACE_V4_TUNING } from "./engine/v4/tuning.ts";
import { entrantsFromAbilitiesRows } from "./engine/v4/adapters/entrantAdapter.ts";

// #5516 — balance-drift-vagten målte kun engine_version=2 (race v3). Den dag
// race_engine_v4 tændes for alle løb, ville den blive blind og se grøn ud.
// Denne fil låser v4-seriens kontrakt ende-til-ende gennem runBalanceDriftWatch:
//   1. Uden v4-runs er den persisterede række OG alarmteksten byte for byte som
//      før #5516 (golden fanget fra koden før ændringen).
//   2. Tom dag, blandet dag og ren v4-dag.
//   3. v4-favoritten er SAMME definition som harnessets favorite_win_rate-anker
//      (headToHeadAnchors.scoreDominance) — målt på de samme etaper.
//   4. v4 og v3 blandes aldrig: den blandede dags v3-del er identisk med en ren
//      v3-dag, og dens v4-del identisk med en ren v4-dag.
//   5. Alarmteksten nævner motorversionen.
//
// Alle tal er syntetiske fixture-værdier, ikke målte balance-tal.

const NOW = new Date("2026-09-11T02:00:00.000Z"); // måldag = 2026-09-10
const DAY_TS = "2026-09-10T12:00:00.000Z";
const PREV_DAY_TS = "2026-09-09T12:00:00.000Z";

// Tabel-bevidst supabase-stub: anvender eq/in/gte/lt/gt-filtrene, order,
// limit og range, så v3- og v4-forespørgslerne hver får præcis deres rækker.
function makeTableStub(tables) {
  const upserts = [];
  const selects = [];
  function query(table) {
    const filters = [];
    let orderCol = null;
    let ascending = true;
    let limitN = null;
    let rangeFrom = null;
    let rangeTo = null;
    const run = () => {
      let rows = (tables[table] || []).filter((row) => filters.every((f) => f(row)));
      if (orderCol) {
        rows = [...rows].sort((a, b) => {
          const x = a[orderCol];
          const y = b[orderCol];
          const c = x < y ? -1 : x > y ? 1 : 0;
          return ascending ? c : -c;
        });
      }
      if (rangeFrom != null) rows = rows.slice(rangeFrom, rangeTo + 1);
      if (limitN != null) rows = rows.slice(0, limitN);
      return { data: rows.map((r) => ({ ...r })), error: null };
    };
    const q = {
      select: () => q,
      eq: (c, v) => { filters.push((r) => r[c] === v); return q; },
      in: (c, vs) => { filters.push((r) => vs.includes(r[c])); return q; },
      gte: (c, v) => { filters.push((r) => r[c] >= v); return q; },
      lt: (c, v) => { filters.push((r) => r[c] < v); return q; },
      gt: (c, v) => { filters.push((r) => r[c] > v); return q; },
      order: (c, opts) => { orderCol = c; ascending = opts?.ascending !== false; return q; },
      limit: (n) => { limitN = n; return q; },
      range: (f, t) => { rangeFrom = f; rangeTo = t; return q; },
      maybeSingle: () => {
        const { data } = run();
        return Promise.resolve({ data: data[0] ?? null, error: null });
      },
      then: (resolve, reject) => Promise.resolve(run()).then(resolve, reject),
    };
    return q;
  }
  return {
    selects,
    upserts,
    from(table) {
      return {
        select: (...args) => {
          selects.push(table);
          return query(table).select(...args);
        },
        upsert: (row, opts) => {
          upserts.push({ table, row, opts });
          return Promise.resolve({ error: null });
        },
      };
    },
  };
}

const pad = (n) => String(n).padStart(2, "0");

// ── v3-fixture (engine_version=2) ────────────────────────────────────────────
function v3Tables() {
  const scores = [];
  const results = [];
  let seq = 0;
  // race-a: a01 er favorit (højeste terrain) og vinder; a01-a04 på samme hold.
  for (let i = 1; i <= 11; i++) {
    const rider = `a${pad(i)}`;
    scores.push({ run_id: "run-a1", rider_id: rider, rank: i,
      components: { terrain: i === 1 ? 90 : 50 - i, ...(i === 5 ? { jour_sans: -2 } : {}) } });
    results.push({ id: `res-v3-${pad(++seq)}`, race_id: "race-a", stage_number: 1, result_type: "stage",
      rider_id: rider, team_id: i <= 4 ? "team-1" : `team-a${i}`, rank: i, in_breakaway: false, imported_at: DAY_TS });
  }
  // race-b: b01 er favorit men bliver nr. 2; vinderen kom fra udbruddet.
  for (let i = 1; i <= 10; i++) {
    const rider = `b${pad(i)}`;
    const rank = i === 1 ? 2 : i === 2 ? 1 : i;
    scores.push({ run_id: "run-b1", rider_id: rider, rank, components: { terrain: i === 1 ? 88 : 40 - i } });
    results.push({ id: `res-v3-${pad(++seq)}`, race_id: "race-b", stage_number: 1, result_type: "stage",
      rider_id: rider, team_id: `team-b${i}`, rank, in_breakaway: rank === 1, imported_at: DAY_TS });
  }
  return {
    race_simulation_runs: [
      { id: "run-a1", race_id: "race-a", stage_number: 1, engine_version: 2, created_at: DAY_TS,
        entrant_snapshot: Array.from({ length: 12 }, (_, i) => `a${pad(i + 1)}`) },
      { id: "run-b1", race_id: "race-b", stage_number: 1, engine_version: 2, created_at: DAY_TS,
        entrant_snapshot: Array.from({ length: 10 }, (_, i) => `b${pad(i + 1)}`) },
    ],
    race_simulation_rider_scores: scores,
    race_results: results,
    races: [
      { id: "race-a", league_division_id: "div-1" },
      { id: "race-b", league_division_id: "div-3" },
    ],
    league_divisions: [
      { id: "div-1", tier: 1 },
      { id: "div-3", tier: 3 },
    ],
    race_incidents: [
      { id: "inc-v3-01", race_id: "race-a", stage_number: 1, rider_id: "a12", kind: "crash", outcome: "abandon" },
    ],
  };
}

// ── v4-fixture (engine_version=4) ────────────────────────────────────────────
//
// race-c etape 2 (bunch_sprint): c05 er spurter og favorit, og vinder. c01-c04
// på samme hold (4 i top 10). c11 styrter ud, c12 udenfor tidsgrænsen, c03 har
// et tidstab. race-c etape 1 er fra I GÅR og må ikke tælle med.
// race-d etape 1 (ingen finale_type ⇒ fallback-vektor): d12 er feltets
// stærkeste og FAVORIT, men styrter ud — favoritten vandt altså ikke, og kom
// ikke på podiet. En favorit valgt blandt finisherne alene ville have været
// d02 (nr. 2 ⇒ podie) — det er præcis den skævhed startfelt-rekonstruktionen
// fjerner.
const SPRINT_KEYS = new Set(["sprint", "acceleration", "positioning", "flat"]);
const CLIMB_KEYS = new Set(["climbing", "endurance", "tempo"]);

function abilityRow(riderId, valueFor) {
  return { rider_id: riderId, ...Object.fromEntries(REGISTRY_ABILITY_KEYS.map((k) => [k, valueFor(k)])) };
}

function v4AbilityRows() {
  const rows = [];
  for (let i = 1; i <= 12; i++) {
    const id = `c${pad(i)}`;
    if (id === "c05") rows.push(abilityRow(id, (k) => (SPRINT_KEYS.has(k) ? 90 : 40)));
    else if (id === "c06") rows.push(abilityRow(id, (k) => (CLIMB_KEYS.has(k) ? 95 : 40)));
    else if (id === "c11") rows.push(abilityRow(id, () => 70));
    else if (id === "c12") rows.push(abilityRow(id, () => 55));
    else rows.push(abilityRow(id, () => 50));
  }
  for (let i = 1; i <= 12; i++) {
    const id = `d${pad(i)}`;
    rows.push(abilityRow(id, () => (id === "d12" ? 95 : id === "d02" ? 90 : 50)));
  }
  return rows;
}

const RACE_C_ORDER = ["c05", "c01", "c02", "c03", "c04", "c06", "c07", "c08", "c09", "c10"];
const teamOfC = (id) => (["c01", "c02", "c03", "c04"].includes(id) ? "team-c1" : `team-${id}`);

function v4Tables({ raceCFinale = "bunch_sprint" } = {}) {
  const results = [];
  let seq = 0;
  RACE_C_ORDER.forEach((id, idx) => {
    results.push({ id: `res-v4-${pad(++seq)}`, race_id: "race-c", stage_number: 2, result_type: "stage",
      rider_id: id, team_id: teamOfC(id), rank: idx + 1, in_breakaway: false, imported_at: DAY_TS });
  });
  for (let i = 1; i <= 11; i++) {
    const id = `d${pad(i)}`;
    results.push({ id: `res-v4-${pad(++seq)}`, race_id: "race-d", stage_number: 1, result_type: "stage",
      rider_id: id, team_id: `team-${id}`, rank: i, in_breakaway: false, imported_at: DAY_TS });
  }
  // Gårsdagens etape 1 af race-c: c11 vandt. Må ikke optræde i dagens v4-serie.
  for (let i = 1; i <= 12; i++) {
    const id = `c${pad(((i + 9) % 12) + 1)}`;
    results.push({ id: `res-v4-old-${pad(i)}`, race_id: "race-c", stage_number: 1, result_type: "stage",
      rider_id: id, team_id: teamOfC(id), rank: i, in_breakaway: false, imported_at: PREV_DAY_TS });
  }
  return {
    race_simulation_runs: [
      { id: "run-c2", race_id: "race-c", stage_number: 2, engine_version: 4, created_at: DAY_TS,
        entrant_snapshot: Array.from({ length: 12 }, (_, i) => `c${pad(i + 1)}`) },
      { id: "run-d1", race_id: "race-d", stage_number: 1, engine_version: 4, created_at: DAY_TS,
        entrant_snapshot: Array.from({ length: 12 }, (_, i) => `d${pad(i + 1)}`) },
      { id: "run-c1", race_id: "race-c", stage_number: 1, engine_version: 4, created_at: PREV_DAY_TS,
        entrant_snapshot: Array.from({ length: 12 }, (_, i) => `c${pad(i + 1)}`) },
    ],
    race_results: results,
    race_incidents: [
      { id: "inc-v4-01", race_id: "race-c", stage_number: 2, rider_id: "c11", kind: "crash", outcome: "abandon" },
      { id: "inc-v4-02", race_id: "race-c", stage_number: 2, rider_id: "c12", kind: "time_limit", outcome: "abandon" },
      { id: "inc-v4-03", race_id: "race-c", stage_number: 2, rider_id: "c03", kind: "crash", outcome: "time_loss" },
      { id: "inc-v4-04", race_id: "race-d", stage_number: 1, rider_id: "d12", kind: "crash", outcome: "abandon" },
      { id: "inc-v4-05", race_id: "race-c", stage_number: 1, rider_id: "c07", kind: "crash", outcome: "abandon" },
    ],
    race_stage_profiles: [
      { id: "prof-c1", race_id: "race-c", stage_number: 1, profile_type: "mountain", finale_type: "long_climb" },
      { id: "prof-c2", race_id: "race-c", stage_number: 2, profile_type: "flat", finale_type: raceCFinale },
      { id: "prof-d1", race_id: "race-d", stage_number: 1, profile_type: "hilly", finale_type: null },
    ],
    rider_derived_abilities: v4AbilityRows(),
  };
}

function merge(...parts) {
  const out = {};
  for (const part of parts) {
    for (const [table, rows] of Object.entries(part)) out[table] = [...(out[table] || []), ...rows];
  }
  return out;
}

const PRIOR_V3_RED = [
  { metric_date: "2026-09-08", metrics: { favoriteWinRate: 0.5, stageInstances: 2 },
    statuses: { favoriteWinRate: { status: "red" } } },
  { metric_date: "2026-09-09", metrics: { favoriteWinRate: 0.5, stageInstances: 2 },
    statuses: { favoriteWinRate: { status: "red" } } },
];
const PRIOR_V4_RED = [
  { metric_date: "2026-09-08", metrics: { v4: { favoriteWinRate: 0.5, stageInstances: 2 } },
    statuses: { v4: { favoriteWinRate: { status: "red" } } } },
  { metric_date: "2026-09-09", metrics: { v4: { favoriteWinRate: 0.5, stageInstances: 2 } },
    statuses: { v4: { favoriteWinRate: { status: "red" } } } },
];
const PRIOR_BOTH_RED = PRIOR_V3_RED.map((row, i) => ({
  metric_date: row.metric_date,
  metrics: { ...row.metrics, ...PRIOR_V4_RED[i].metrics },
  statuses: { ...row.statuses, ...PRIOR_V4_RED[i].statuses },
}));

async function runWith(tables, extra = {}) {
  const supabase = makeTableStub(tables);
  const sent = [];
  const captured = [];
  const result = await runBalanceDriftWatch({
    supabase,
    now: NOW,
    sendWebhookFn: async (url, payload) => { sent.push({ url, payload }); },
    getOpsWebhookFn: async () => "https://example.invalid/ops",
    captureExceptionFn: (err) => captured.push(err),
    ...extra,
  });
  const driftRows = supabase.upserts.filter((u) => u.table === "race_balance_drift_daily").map((u) => u.row);
  const alertState = supabase.upserts.filter((u) => u.table === "ops_alert_state").map((u) => u.row);
  return { result, supabase, sent, captured, driftRows, alertState };
}

function persistedJson(row) {
  return JSON.stringify({ metric_date: row.metric_date, metrics: row.metrics, statuses: row.statuses });
}

// Bånd-objekterne er de kanoniske BALANCE_DRIFT_BANDS (tjekket separat pr.
// reference nedenfor) — de normaliseres ud af golden-strengen.
const normalizeBands = (json) => json.replace(/"band":\{[^{}]*\}/g, '"band":"*"');

function withoutV4(obj) {
  const { v4: _v4, ...rest } = obj;
  return rest;
}

// Fanget fra runBalanceDriftWatch FØR #5516 (commit c94b09e95) på v3Tables()
// + PRIOR_V3_RED. Ændrer denne streng sig, har en dag uden v4-runs ændret adfærd.
const GOLDEN_V3_PERSISTED = '{"metric_date":"2026-09-10","metrics":{"favoriteWinRate":0.5,"favoritePodiumRate":1,"share4PlusSameTeamTop10":0.5,"avgDistinctTeamsTop10":8.5,"dnfRatePct":4.166666666666667,"maxRiderWinRate":null,"maxRiderWinRateLb":null,"maxRiderWinRateRiders":0,"maxRiderDominantWinCount":null,"maxRiderDominantWinCountRiders":0,"jourSansSharePct":4.761904761904762,"breakawayWinSharePct":50,"stageInstances":2,"incidentStages":2,"byTier":{"tier1":{"stages":1,"favoriteWinRate":1,"favoritePodiumRate":1,"share4PlusSameTeamTop10":1,"avgDistinctTeamsTop10":7},"tier3":{"stages":1,"favoriteWinRate":0,"favoritePodiumRate":1,"share4PlusSameTeamTop10":0,"avgDistinctTeamsTop10":10}},"share4PlusByRace":{"race-a":{"hits":1,"stages":1},"race-b":{"hits":0,"stages":1}},"share4PlusClusterSe":{"clusters":2,"stages":2,"hits":1,"naiveEstimate":0.5,"naiveSe":0.3535533905932738,"clusterEstimate":0.5,"clusterSd":0.7071067811865476,"clusterSe":0.5,"days":1}},"statuses":{"favoriteWinRate":{"value":0.5,"band":"*","status":"red","basis":"day","dayValue":0.5},"favoritePodiumRate":{"value":1,"band":"*","status":"red","basis":"day","dayValue":1},"share4PlusSameTeamTop10":{"value":0.5,"band":"*","status":"red","basis":"day","dayValue":0.5},"avgDistinctTeamsTop10":{"value":8.5,"band":"*","status":"green","basis":"day","dayValue":8.5},"dnfRatePct":{"value":4.166666666666667,"band":"*","status":"red","basis":"day","dayValue":4.166666666666667},"maxRiderWinRate":{"value":null,"band":"*","status":"n/a","basis":"day","dayValue":null},"jourSansSharePct":{"value":4.761904761904762,"band":"*","status":"info","basis":"day","dayValue":4.761904761904762},"breakawayWinSharePct":{"value":50,"band":"*","status":"info","basis":"day","dayValue":50},"maxRiderDominantWinCount":{"value":null,"band":"*","status":"n/a","basis":"day","dayValue":null},"byTier":{"tier1":{"favoriteWinRate":{"value":1,"status":"red"},"favoritePodiumRate":{"value":1,"status":"red"},"share4PlusSameTeamTop10":{"value":1,"status":"red"},"avgDistinctTeamsTop10":{"value":7,"status":"yellow"}},"tier3":{"favoriteWinRate":{"value":0,"status":"red"},"favoritePodiumRate":{"value":1,"status":"red"},"share4PlusSameTeamTop10":{"value":0,"status":"green"},"avgDistinctTeamsTop10":{"value":10,"status":"green"}}}}}';
const GOLDEN_V3_EMBEDS = '[[{"title":"⚠️ Balance-drift-vagt: 1 bånd-brud i 3+ dage","description":"Race v3-kalibreringen har drevet uden for kanoniske bånd i mindst 3 på hinanden følgende dage (seneste målt: 2026-09-10). Read-only vagt — ingen automatisk handling.","color":15965202,"fields":[{"name":"favoriteWinRate","value":"3 dage i træk (siden 2026-09-08) · seneste værdi 0.5"}]}]]';

const embedsJson = (sent) =>
  JSON.stringify(sent.map((s) => s.payload.embeds.map(({ timestamp: _ts, ...rest }) => rest)));

function spyImport() {
  const calls = [];
  return {
    calls,
    importModule: (href) => {
      calls.push(href);
      return import(href);
    },
  };
}

// ── 1. Bit-identitet uden v4-runs ───────────────────────────────────────────

test("uden v4-runs: persisteret række og alarmtekst er byte for byte som før #5516", async () => {
  const spy = spyImport();
  const out = await runWith({ ...v3Tables(), race_balance_drift_daily: PRIOR_V3_RED, ops_alert_state: [] },
    { importModule: spy.importModule });

  assert.deepEqual(out.captured, []);
  assert.equal(out.driftRows.length, 1);
  assert.equal(normalizeBands(persistedJson(out.driftRows[0])), GOLDEN_V3_PERSISTED);
  for (const [key, cell] of Object.entries(out.driftRows[0].statuses)) {
    if (key === "byTier") continue;
    assert.equal(cell.band, BALANCE_DRIFT_BANDS[key], `${key} skal klassificeres mod det kanoniske bånd`);
  }
  assert.equal(embedsJson(out.sent), GOLDEN_V3_EMBEDS);
  // Dedup-signaturen er også uændret — ellers ville deployet gen-alarmere.
  assert.equal(out.alertState[0]?.signature, "favoriteWinRate@2026-09-08");
  assert.deepEqual(spy.calls, [], "en dag uden v4-runs må ikke loade ét v4-modul");
});

// ── 2. Tom dag ──────────────────────────────────────────────────────────────

test("tom dag: ingen runs overhovedet ⇒ række uden v4-nøgle, ingen fejl, ingen v4-modul-load", async () => {
  const spy = spyImport();
  const out = await runWith({}, { importModule: spy.importModule });

  assert.deepEqual(out.captured, []);
  assert.equal(out.driftRows.length, 1);
  assert.equal(out.driftRows[0].metric_date, "2026-09-10");
  assert.equal("v4" in out.driftRows[0].metrics, false);
  assert.equal("v4" in out.driftRows[0].statuses, false);
  assert.deepEqual(spy.calls, []);
  assert.equal(await fetchV4DayInputs(makeTableStub({}), "2026-09-10", { importModule: spy.importModule }), null);
});

// ── 3. Ren v4-dag ───────────────────────────────────────────────────────────

test("ren v4-dag: v4-serien måles fra race_results + evner + race_incidents under metrics.v4", async () => {
  const out = await runWith({ ...v4Tables(), race_balance_drift_daily: [], ops_alert_state: [] });
  assert.deepEqual(out.captured, []);
  const row = out.driftRows[0];
  const v4 = row.metrics.v4;

  // race-c: favoritten (c05) vinder. race-d: favoritten (d12) styrter ud.
  assert.equal(v4.favoriteWinRate, 0.5);
  assert.equal(v4.favoritePodiumRate, 0.5, "d12 er favorit selvom han udgik — ikke næstbedste finisher d02");
  assert.equal(v4.share4PlusSameTeamTop10, 0.5);
  assert.equal(v4.avgDistinctTeamsTop10, 8.5);
  // DNF som i v3 (outcome='abandon' / feltstørrelse), uden tidsgrænsen.
  assert.equal(v4.dnfRatePct, 100 / 12);
  assert.equal(v4.timeLimitRatePct, 100 / 24);
  assert.equal(v4.stageInstances, 2, "gårsdagens race-c etape 1 må ikke tælle med");
  assert.equal(v4.incidentStages, 2);
  assert.equal(v4.favoriteUnknownStages, 0);

  // v3-serien så ingen v3-runs: n/a, ikke v4-tal.
  assert.equal(row.metrics.favoriteWinRate, null);
  assert.equal(row.metrics.stageInstances, 0);
  assert.equal(row.statuses.favoriteWinRate.status, "n/a");

  // Klassificeret mod de SAMME kanoniske bånd, kun v4-seriens metrikker.
  assert.deepEqual(Object.keys(row.statuses.v4), [...V4_SERIES_METRICS]);
  for (const key of V4_SERIES_METRICS) {
    assert.equal(row.statuses.v4[key].band, BALANCE_DRIFT_BANDS[key]);
    assert.equal(row.statuses.v4[key].value, v4[key]);
  }
  assert.equal(row.statuses.v4.favoriteWinRate.status, "red");
});

test("ren v4-dag: favoritten styres af etapens finale_type (race_stage_profiles)", async () => {
  // Samme etape, men som bjergfinale: klatreren c06 (nr. 6) bliver favorit.
  const out = await runWith({ ...v4Tables({ raceCFinale: "long_climb" }), race_balance_drift_daily: [], ops_alert_state: [] });
  const v4 = out.driftRows[0].metrics.v4;
  assert.equal(v4.favoriteWinRate, 0);
  assert.equal(v4.favoritePodiumRate, 0);
});

test("v4-favoritten er SAMME definition som harnessets favorite_win_rate-anker", async () => {
  for (const raceCFinale of ["bunch_sprint", "long_climb"]) {
    const tables = v4Tables({ raceCFinale });
    const out = await runWith({ ...tables, race_balance_drift_daily: [], ops_alert_state: [] });
    const v4 = out.driftRows[0].metrics.v4;

    // Harnessets input for de samme to etaper: motorens resultatliste
    // (finishere, så tidsgrænse, så udgåede) + evnerne som v4-entrants.
    const entrants = Object.fromEntries(
      entrantsFromAbilitiesRows(tables.rider_derived_abilities).map((e) => [e.rider_id, e]),
    );
    const teamByRider = new Map(tables.race_results.map((r) => [r.rider_id, r.team_id]));
    const toResults = (ids) => ids.map((id, idx) => ({ rider_id: id, rank: idx + 1 }));
    const harnessRow = (raceId, ids, profile) => ({
      raw: {
        v3Output: { ranked: [] },
        v4Output: { results: toResults(ids) },
        route: { profile_type: profile.profile_type, finale_type: profile.finale_type },
        tuning: RACE_V4_TUNING,
        stageRow: { race_id: raceId },
      },
    });
    const profile = (id) => tables.race_stage_profiles.find((p) => p.id === id);
    const rows = [
      harnessRow("race-c", [...RACE_C_ORDER, "c12", "c11"], profile("prof-c2")),
      harnessRow("race-d", [...Array.from({ length: 11 }, (_, i) => `d${pad(i + 1)}`), "d12"], profile("prof-d1")),
    ];
    const anchors = scoreDominance(rows, { teamByRider, v4EntrantsById: entrants });
    const winAnchor = anchors.find((a) => a.id === "favorite_win_rate");
    const teamAnchor = anchors.find((a) => a.id === "same_team_top10_share_4plus");

    assert.equal(v4.favoriteWinRate, winAnchor.v4.value, `favorit-win (${raceCFinale})`);
    assert.equal(v4.share4PlusSameTeamTop10, teamAnchor.v4.value, `samme-hold-top-10 (${raceCFinale})`);
  }
});

// ── 4. Blandet dag ──────────────────────────────────────────────────────────

test("blandet dag: v3-delen er identisk med en ren v3-dag, v4-delen med en ren v4-dag", async () => {
  const v3Only = await runWith({ ...v3Tables(), race_balance_drift_daily: [], ops_alert_state: [] });
  const v4Only = await runWith({ ...v4Tables(), race_balance_drift_daily: [], ops_alert_state: [] });
  const mixed = await runWith({ ...merge(v3Tables(), v4Tables()), race_balance_drift_daily: [], ops_alert_state: [] });

  assert.deepEqual(mixed.captured, []);
  const row = mixed.driftRows[0];
  assert.equal(
    JSON.stringify(withoutV4(row.metrics)),
    JSON.stringify(v3Only.driftRows[0].metrics),
    "v3-metrikkerne må ikke påvirkes af dagens v4-etaper",
  );
  assert.equal(JSON.stringify(withoutV4(row.statuses)), JSON.stringify(v3Only.driftRows[0].statuses));
  assert.equal(JSON.stringify(row.metrics.v4), JSON.stringify(v4Only.driftRows[0].metrics.v4));
  assert.equal(JSON.stringify(row.statuses.v4), JSON.stringify(v4Only.driftRows[0].statuses.v4));
});

// ── 5. Alarmtekst nævner motorversion ───────────────────────────────────────

test("v4-brud i 3 dage alarmerer med motorversion i tekst og dedup-signatur", async () => {
  const out = await runWith({ ...v4Tables(), race_balance_drift_daily: PRIOR_V4_RED, ops_alert_state: [] });

  assert.deepEqual(out.result.breaches, [{ metric: "favoriteWinRate", days: 3, since: "2026-09-08", engine: "v4" }]);
  assert.equal(out.sent.length, 1);
  const embed = out.sent[0].payload.embeds[0];
  assert.match(embed.description, /^Race v4-kalibreringen har drevet uden for kanoniske bånd/);
  assert.deepEqual(embed.fields, [
    { name: "v4 · favoriteWinRate", value: "3 dage i træk (siden 2026-09-08) · seneste værdi 0.5" },
  ]);
  assert.equal(out.alertState[0]?.signature, "v4:favoriteWinRate@2026-09-08");
});

test("brud i både v3 og v4 samme dag: én alarm der navngiver begge motorer", async () => {
  const out = await runWith({ ...merge(v3Tables(), v4Tables()), race_balance_drift_daily: PRIOR_BOTH_RED, ops_alert_state: [] });

  assert.equal(out.sent.length, 1);
  const embed = out.sent[0].payload.embeds[0];
  assert.match(embed.title, /2 bånd-brud/);
  assert.match(embed.description, /^Race v3- og v4-kalibreringen har drevet/);
  assert.deepEqual(embed.fields.map((f) => f.name), ["v3 · favoriteWinRate", "v4 · favoriteWinRate"]);
  assert.equal(out.alertState[0]?.signature, "favoriteWinRate@2026-09-08|v4:favoriteWinRate@2026-09-08");
});

test("en v4-streak brydes af en dag uden v4-runs (intet gæt på manglende data)", async () => {
  const prior = [
    PRIOR_V4_RED[0],
    { metric_date: "2026-09-09", metrics: { favoriteWinRate: 0.3, stageInstances: 2 }, statuses: {} },
  ];
  const out = await runWith({ ...v4Tables(), race_balance_drift_daily: prior, ops_alert_state: [] });
  assert.deepEqual(out.result.breaches, []);
  assert.equal(out.sent.length, 0);
});

// ── 6. v4-fejl tager aldrig v3 med ──────────────────────────────────────────

test("et v4-modul der ikke kan loades rapporteres, og v3-rækken skrives uændret", async () => {
  const out = await runWith(
    { ...merge(v3Tables(), v4Tables()), race_balance_drift_daily: PRIOR_V3_RED, ops_alert_state: [] },
    { importModule: () => Promise.reject(new Error("modul utilgængeligt")) },
  );

  assert.equal(out.captured.length, 1);
  assert.match(out.captured[0].message, /v4-serie: modul utilgængeligt/);
  assert.equal(out.driftRows.length, 1);
  assert.equal(normalizeBands(persistedJson(out.driftRows[0])), GOLDEN_V3_PERSISTED);
  assert.equal(embedsJson(out.sent), GOLDEN_V3_EMBEDS);
});
