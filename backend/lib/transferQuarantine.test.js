import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_QUARANTINE_MARGIN,
  MONUMENT_GAME_DAY_FLOOR,
  QUARANTINE_MIN_AVAILABLE,
  QUARANTINE_RIVAL_RANK,
  QUARANTINE_SCOPES,
  TRANSFER_QUARANTINE_CONFIG_KEYS,
  applyQuarantineToCandidates,
  blockedRiderIdsForRace,
  buildPoolRaceDays,
  disabledQuarantineConfig,
  evaluateQuarantineTrigger,
  isAcquisitionInTransferWindow,
  isQuarantineEnabled,
  isRaceBlockedForRider,
  loadQuarantineState,
  planTeamQuarantine,
  poolRivalPeak,
  readTransferQuarantineConfig,
  riderPeak,
} from "./transferQuarantine.js";

const HOUR = 60 * 60 * 1000;

// Puljekalender: 8 løbsdage, 6 timer mellem hver (samme kadence som prod: ~2
// game_days pr. CET-dag).
const T0 = Date.parse("2026-07-27T12:00:00Z");
function poolDays(count = 8, step = 6 * HOUR) {
  return Array.from({ length: count }, (_, i) => ({ gameDay: i, startsAt: T0 + i * step }));
}

// ── readTransferQuarantineConfig ──────────────────────────────────────────────

function configClient(rows, { error = null, throws = false } = {}) {
  return {
    from() {
      return {
        select() {
          return {
            in() {
              if (throws) throw new Error("boom");
              return Promise.resolve({ data: rows, error });
            },
          };
        },
      };
    },
  };
}

test("readTransferQuarantineConfig: ingen rows → slået fra", async () => {
  const cfg = await readTransferQuarantineConfig(configClient([]));
  assert.deepEqual(cfg, disabledQuarantineConfig());
  assert.equal(cfg.scope, QUARANTINE_SCOPES.OFF);
  assert.equal(cfg.raceDays, 0);
  assert.equal(cfg.margin, DEFAULT_QUARANTINE_MARGIN);
});

test("readTransferQuarantineConfig: læser alle fire nøgler", async () => {
  const cfg = await readTransferQuarantineConfig(configClient([
    { key: TRANSFER_QUARANTINE_CONFIG_KEYS.SCOPE, value: "overqualified" },
    { key: TRANSFER_QUARANTINE_CONFIG_KEYS.RACE_DAYS, value: 4 },
    { key: TRANSFER_QUARANTINE_CONFIG_KEYS.MARGIN, value: 8 },
    { key: TRANSFER_QUARANTINE_CONFIG_KEYS.MAX_DEBUTS_PER_RACE_DAY, value: 1 },
  ]));
  assert.deepEqual(cfg, { scope: "overqualified", raceDays: 4, margin: 8, maxDebutsPerRaceDay: 1 });
});

test("readTransferQuarantineConfig: ukendt scope-værdi → off (fail-safe)", async () => {
  const cfg = await readTransferQuarantineConfig(configClient([
    { key: TRANSFER_QUARANTINE_CONFIG_KEYS.SCOPE, value: "aggressive" },
    { key: TRANSFER_QUARANTINE_CONFIG_KEYS.RACE_DAYS, value: 4 },
  ]));
  assert.equal(cfg.scope, QUARANTINE_SCOPES.OFF);
  assert.equal(isQuarantineEnabled(cfg), false);
});

test("readTransferQuarantineConfig: negative/malformede tal → sikre defaults", async () => {
  const cfg = await readTransferQuarantineConfig(configClient([
    { key: TRANSFER_QUARANTINE_CONFIG_KEYS.SCOPE, value: "ALL" },
    { key: TRANSFER_QUARANTINE_CONFIG_KEYS.RACE_DAYS, value: -3 },
    { key: TRANSFER_QUARANTINE_CONFIG_KEYS.MARGIN, value: "nope" },
  ]));
  assert.equal(cfg.scope, QUARANTINE_SCOPES.ALL, "scope er case-insensitiv");
  assert.equal(cfg.raceDays, 0);
  assert.equal(cfg.margin, DEFAULT_QUARANTINE_MARGIN);
  assert.equal(isQuarantineEnabled(cfg), false, "raceDays 0 slår gaten fra uanset scope");
});

test("readTransferQuarantineConfig: db-fejl og exception → fail-safe DISABLED", async () => {
  assert.deepEqual(await readTransferQuarantineConfig(configClient(null, { error: { message: "down" } })), disabledQuarantineConfig());
  assert.deepEqual(await readTransferQuarantineConfig(configClient(null, { throws: true })), disabledQuarantineConfig());
  assert.deepEqual(await readTransferQuarantineConfig(null), disabledQuarantineConfig());
});

// ── isQuarantineEnabled ───────────────────────────────────────────────────────

test("isQuarantineEnabled: kræver BÅDE scope != off OG raceDays > 0", () => {
  assert.equal(isQuarantineEnabled({ scope: "off", raceDays: 5 }), false);
  assert.equal(isQuarantineEnabled({ scope: "overqualified", raceDays: 0 }), false);
  assert.equal(isQuarantineEnabled({ scope: "overqualified", raceDays: 1 }), true);
  assert.equal(isQuarantineEnabled({ scope: "all", raceDays: 2 }), true);
  assert.equal(isQuarantineEnabled(null), false);
});

// ── riderPeak / poolRivalPeak ─────────────────────────────────────────────────

test("riderPeak: max over de seks sejrs-discipliner, ignorerer øvrige evner", () => {
  assert.equal(riderPeak({ flat: 40, climbing: 66, sprint: 30, time_trial: 51, punch: 44, cobblestone: 20 }), 66);
  // endurance/tactics m.fl. må ALDRIG kunne løfte peak — de afgør ikke en etapesejr.
  assert.equal(riderPeak({ flat: 10, endurance: 99, tactics: 99, positioning: 99 }), 10);
  assert.equal(riderPeak({}), 0);
  assert.equal(riderPeak(null), 0);
});

test("poolRivalPeak: 10.-bedste rytter uden for eget hold", () => {
  const pool = [];
  for (let i = 0; i < 12; i++) pool.push({ teamId: "rival", peak: 50 - i }); // 50..39
  pool.push({ teamId: "mine", peak: 99 });
  // 10.-bedste rival = 50 - 9 = 41. Eget holds 99 må ikke tælle med.
  assert.equal(poolRivalPeak(pool, "mine"), 41);
  assert.equal(QUARANTINE_RIVAL_RANK, 10);
});

test("poolRivalPeak: for lille pulje → null (ingen benchmark, ingen karantæne)", () => {
  const pool = Array.from({ length: 9 }, () => ({ teamId: "rival", peak: 40 }));
  assert.equal(poolRivalPeak(pool, "mine"), null);
});

// ── evaluateQuarantineTrigger ─────────────────────────────────────────────────

test("evaluateQuarantineTrigger: scope=all udløser uanset evner", () => {
  const r = evaluateQuarantineTrigger({ scope: QUARANTINE_SCOPES.ALL, peak: 1, rivalPeak: 90 });
  assert.equal(r.triggered, true);
  assert.equal(r.reason, "all");
});

test("evaluateQuarantineTrigger: scope=off udløser aldrig", () => {
  assert.equal(evaluateQuarantineTrigger({ scope: QUARANTINE_SCOPES.OFF, peak: 99, rivalPeak: 10 }).triggered, false);
});

test("evaluateQuarantineTrigger: overqualified — Wander Riders-casen (peak 66 mod rival 38)", () => {
  // Lars Wouters, fri agent, peak 66 ind i Div 3 — D hvis 10.-bedste rival var 38.
  const r = evaluateQuarantineTrigger({ scope: "overqualified", margin: 10, peak: 66, rivalPeak: 38 });
  assert.equal(r.triggered, true);
  assert.equal(r.reason, "overqualified");
  assert.equal(r.margin, 28);
});

test("evaluateQuarantineTrigger: overqualified — margin præcis på tærsklen udløser (>=)", () => {
  assert.equal(evaluateQuarantineTrigger({ scope: "overqualified", margin: 10, peak: 48, rivalPeak: 38 }).triggered, true);
  assert.equal(evaluateQuarantineTrigger({ scope: "overqualified", margin: 10, peak: 47, rivalPeak: 38 }).triggered, false);
});

test("evaluateQuarantineTrigger: ukendt rivalPeak (for lille pulje) → ingen karantæne", () => {
  assert.equal(evaluateQuarantineTrigger({ scope: "overqualified", margin: 10, peak: 99, rivalPeak: null }).triggered, false);
});

// ── isAcquisitionInTransferWindow ─────────────────────────────────────────────

test("isAcquisitionInTransferWindow: prod-casen — Zupan (26/7 22:41) er inde, gammelt ejerskab er ude", () => {
  // Sæson 1's sidste etape kørte 26/7 19:00 CET = 17:00Z (målt i prod).
  const windowStartsAt = "2026-07-26T17:00:00Z";
  assert.equal(isAcquisitionInTransferWindow({ acquiredAt: "2026-07-26T20:41:24Z", windowStartsAt }), true, "Dawid Zupan");
  assert.equal(isAcquisitionInTransferWindow({ acquiredAt: "2026-07-29T21:45:53Z", windowStartsAt }), true, "Lars Wouters");
  assert.equal(isAcquisitionInTransferWindow({ acquiredAt: "2026-07-05T10:00:00Z", windowStartsAt }), false, "ejerskab fra sæson 1");
  assert.equal(isAcquisitionInTransferWindow({ acquiredAt: "2026-07-26T17:00:00Z", windowStartsAt }), false, "selve grænsen er eksklusiv");
});

test("isAcquisitionInTransferWindow: manglende acquired_at → false; ukendt grænse → filtrerer ikke", () => {
  assert.equal(isAcquisitionInTransferWindow({ acquiredAt: null, windowStartsAt: "2026-07-26T17:00:00Z" }), false);
  assert.equal(isAcquisitionInTransferWindow({ acquiredAt: "junk", windowStartsAt: "2026-07-26T17:00:00Z" }), false);
  assert.equal(isAcquisitionInTransferWindow({ acquiredAt: "2026-01-01T00:00:00Z", windowStartsAt: null }), true);
});

// ── buildPoolRaceDays ─────────────────────────────────────────────────────────

test("buildPoolRaceDays: grupperer pr. pulje, tidligste start pr. game_day, sorteret", () => {
  const raceById = new Map([
    ["r1", { league_division_id: 7 }],
    ["r2", { league_division_id: 7 }],
    ["r3", { league_division_id: 5 }],
  ]);
  const rows = [
    { race_id: "r2", game_day: 1, scheduled_at: "2026-07-27T20:20:00Z" },
    { race_id: "r1", game_day: 0, scheduled_at: "2026-07-27T19:20:00Z" },
    { race_id: "r1", game_day: 0, scheduled_at: "2026-07-27T18:20:00Z" }, // tidligere → vinder
    { race_id: "r3", game_day: 0, scheduled_at: "2026-07-27T12:00:00Z" },
  ];
  const out = buildPoolRaceDays(rows, raceById);
  assert.deepEqual(out.get(7), [
    { gameDay: 0, startsAt: Date.parse("2026-07-27T18:20:00Z") },
    { gameDay: 1, startsAt: Date.parse("2026-07-27T20:20:00Z") },
  ]);
  assert.equal(out.get(5).length, 1);
});

test("buildPoolRaceDays: Monument-båndet (game_day >= 100000) udelades", () => {
  const raceById = new Map([["m", { league_division_id: 7 }]]);
  const out = buildPoolRaceDays(
    [{ race_id: "m", game_day: MONUMENT_GAME_DAY_FLOOR + 3, scheduled_at: "2026-08-01T12:00:00Z" }],
    raceById,
  );
  assert.equal(out.size, 0);
});

// ── planTeamQuarantine ────────────────────────────────────────────────────────

test("planTeamQuarantine: blokerer de første n løbsdage EFTER erhvervelsen", () => {
  const days = poolDays(8);
  // Erhvervet lige efter dag 1 startede → første dag der starter bagefter er dag 2.
  const acquiredAt = days[1].startsAt + 1;
  const plan = planTeamQuarantine({
    acquisitions: [{ riderId: "a", acquiredAt }],
    poolRaceDays: days, raceDays: 3,
  });
  assert.deepEqual(plan.get("a").blockedGameDays, [2, 3, 4]);
  assert.equal(plan.get("a").releaseGameDay, 5);
  assert.equal(plan.get("a").staggeredBy, 0);
});

test("planTeamQuarantine: raceDays 0 eller tom kalender → tom plan (aldrig karantæne)", () => {
  assert.equal(planTeamQuarantine({ acquisitions: [{ riderId: "a", acquiredAt: T0 }], poolRaceDays: poolDays(), raceDays: 0 }).size, 0);
  assert.equal(planTeamQuarantine({ acquisitions: [{ riderId: "a", acquiredAt: T0 }], poolRaceDays: [], raceDays: 3 }).size, 0);
});

test("planTeamQuarantine: erhvervet efter sæsonens sidste løbsdag → intet at sidde over", () => {
  const days = poolDays(4);
  const plan = planTeamQuarantine({
    acquisitions: [{ riderId: "a", acquiredAt: days[3].startsAt + HOUR }],
    poolRaceDays: days, raceDays: 3,
  });
  assert.deepEqual(plan.get("a").blockedGameDays, []);
  assert.equal(plan.get("a").releaseGameDay, null);
});

test("planTeamQuarantine: færre dage tilbage end karantænen → blokeret sæsonen ud", () => {
  const days = poolDays(4);
  const plan = planTeamQuarantine({
    acquisitions: [{ riderId: "a", acquiredAt: days[1].startsAt + 1 }],
    poolRaceDays: days, raceDays: 10,
  });
  assert.deepEqual(plan.get("a").blockedGameDays, [2, 3]);
  assert.equal(plan.get("a").releaseGameDay, null, "ingen frigivelsesdag inden for sæsonen");
});

test("planTeamQuarantine: trappen spreder samtidige debuter (30/7-mønsteret)", () => {
  const days = poolDays(10);
  // Tre ryttere købt samme døgn, alle med samme første ledige dag.
  const acquiredAt = days[0].startsAt + 1;
  const plan = planTeamQuarantine({
    acquisitions: [
      { riderId: "c", acquiredAt: acquiredAt + 2 },
      { riderId: "a", acquiredAt },
      { riderId: "b", acquiredAt: acquiredAt + 1 },
    ],
    poolRaceDays: days, raceDays: 2, maxDebutsPerRaceDay: 1,
  });
  // Ældste først: a debuterer dag 3, b skubbes til 4, c til 5.
  assert.equal(plan.get("a").releaseGameDay, 3);
  assert.equal(plan.get("b").releaseGameDay, 4);
  assert.equal(plan.get("c").releaseGameDay, 5);
  assert.equal(plan.get("a").staggeredBy, 0);
  assert.equal(plan.get("b").staggeredBy, 1);
  assert.equal(plan.get("c").staggeredBy, 2);
});

test("planTeamQuarantine: maxDebutsPerRaceDay=0 → ingen trappe, alle frigives samme dag", () => {
  const days = poolDays(10);
  const acquiredAt = days[0].startsAt + 1;
  const plan = planTeamQuarantine({
    acquisitions: [{ riderId: "a", acquiredAt }, { riderId: "b", acquiredAt }],
    poolRaceDays: days, raceDays: 2, maxDebutsPerRaceDay: 0,
  });
  assert.equal(plan.get("a").releaseGameDay, 3);
  assert.equal(plan.get("b").releaseGameDay, 3);
});

test("planTeamQuarantine: deterministisk — samme input giver samme plan uanset input-rækkefølge", () => {
  const days = poolDays(10);
  const at = days[0].startsAt + 1;
  const acq = [{ riderId: "b", acquiredAt: at }, { riderId: "a", acquiredAt: at }];
  const p1 = planTeamQuarantine({ acquisitions: acq, poolRaceDays: days, raceDays: 2, maxDebutsPerRaceDay: 1 });
  const p2 = planTeamQuarantine({ acquisitions: [...acq].reverse(), poolRaceDays: days, raceDays: 2, maxDebutsPerRaceDay: 1 });
  assert.equal(p1.get("a").releaseGameDay, p2.get("a").releaseGameDay);
  assert.equal(p1.get("b").releaseGameDay, p2.get("b").releaseGameDay);
  assert.equal(p1.get("a").releaseGameDay, 3, "riderId bryder tie ved ens acquired_at");
});

test("planTeamQuarantine: ugyldig acquiredAt springes over", () => {
  const plan = planTeamQuarantine({
    acquisitions: [{ riderId: "a", acquiredAt: null }, { riderId: "b", acquiredAt: "not-a-date" }],
    poolRaceDays: poolDays(), raceDays: 3,
  });
  assert.equal(plan.size, 0);
});

// ── isRaceBlockedForRider / blockedRiderIdsForRace ────────────────────────────

test("isRaceBlockedForRider: gater på løbets FØRSTE løbsdag", () => {
  assert.equal(isRaceBlockedForRider({ blockedGameDays: [2, 3, 4], raceGameDayStart: 3 }), true);
  assert.equal(isRaceBlockedForRider({ blockedGameDays: [2, 3, 4], raceGameDayStart: 5 }), false);
  assert.equal(isRaceBlockedForRider({ blockedGameDays: [], raceGameDayStart: 3 }), false);
  assert.equal(isRaceBlockedForRider({ blockedGameDays: [2], raceGameDayStart: null }), false);
});

test("blockedRiderIdsForRace: kun ryttere hvis karantæne dækker løbets startdag", () => {
  const state = {
    byRider: new Map([
      ["r1", { blockedGameDays: [2, 3] }],
      ["r2", { blockedGameDays: [5, 6] }],
    ]),
  };
  assert.deepEqual([...blockedRiderIdsForRace(state, { game_day_start: 3 })], ["r1"]);
  assert.deepEqual([...blockedRiderIdsForRace(state, { game_day_start: 6 })], ["r2"]);
  assert.equal(blockedRiderIdsForRace(state, { game_day_start: 9 }).size, 0);
  assert.equal(blockedRiderIdsForRace(null, { game_day_start: 3 }).size, 0);
});

// ── applyQuarantineToCandidates ───────────────────────────────────────────────

function riders(n, prefix = "r") {
  return Array.from({ length: n }, (_, i) => ({ rider_id: `${prefix}${i}` }));
}

test("applyQuarantineToCandidates: ingen karantæne → uændret kandidatliste", () => {
  const cands = riders(12);
  const out = applyQuarantineToCandidates({ candidates: cands, quarantinedIds: new Set() });
  assert.equal(out.kept, cands, "samme reference når intet filtreres");
  assert.deepEqual(out.blockedRiderIds, []);
});

test("applyQuarantineToCandidates: filtrerer karantæneramte når gulvet holder", () => {
  const out = applyQuarantineToCandidates({
    candidates: riders(12),
    quarantinedIds: new Set(["r0", "r1"]),
  });
  assert.equal(out.kept.length, 10);
  assert.deepEqual(out.blockedRiderIds.sort(), ["r0", "r1"]);
  assert.deepEqual(out.releasedForFloor, []);
});

test("applyQuarantineToCandidates: sikkerhedsgulv — frigiver ældst erhvervede så holdet kan stille op", () => {
  // 10 ryttere, 4 i karantæne → 6 frie, gulvet er 8 → 2 skal frigives.
  const cands = riders(10);
  const quarantined = new Set(["r0", "r1", "r2", "r3"]);
  const acquiredAtByRider = new Map([["r0", 400], ["r1", 100], ["r2", 300], ["r3", 200]]);
  const out = applyQuarantineToCandidates({ candidates: cands, quarantinedIds: quarantined, acquiredAtByRider });
  assert.equal(out.kept.length, QUARANTINE_MIN_AVAILABLE);
  assert.deepEqual(out.releasedForFloor.sort(), ["r1", "r3"], "ældste erhvervelser frigives først");
  assert.deepEqual(out.blockedRiderIds.sort(), ["r0", "r2"]);
});

test("applyQuarantineToCandidates: hold der i forvejen er under gulvet mister ingen ryttere", () => {
  const cands = riders(6);
  const out = applyQuarantineToCandidates({
    candidates: cands,
    quarantinedIds: new Set(["r0", "r1"]),
    acquiredAtByRider: new Map([["r0", 1], ["r1", 2]]),
  });
  assert.equal(out.kept.length, 6, "alle beholdes — karantænen må aldrig tømme et startfelt");
  assert.deepEqual(out.blockedRiderIds, []);
});

test("applyQuarantineToCandidates: accepterer både {id} og {rider_id}", () => {
  const out = applyQuarantineToCandidates({
    candidates: [{ id: "a" }, { id: "b" }, ...riders(9)],
    quarantinedIds: new Set(["a"]),
  });
  assert.equal(out.kept.length, 10);
  assert.deepEqual(out.blockedRiderIds, ["a"]);
});

// ── loadQuarantineState ───────────────────────────────────────────────────────

test("loadQuarantineState: slået fra → NUL database-kald", async () => {
  let calls = 0;
  const supabase = { from() { calls += 1; throw new Error("må ikke kaldes"); } };
  const state = await loadQuarantineState({
    supabase, config: disabledQuarantineConfig(), seasonId: "s1",
  });
  assert.equal(calls, 0);
  assert.equal(state.enabled, false);
  assert.equal(state.byRider.size, 0);
});

test("loadQuarantineState: manglende seasonId/supabase → tom tilstand", async () => {
  const cfg = { scope: "all", raceDays: 2, margin: 10, maxDebutsPerRaceDay: 0 };
  assert.equal((await loadQuarantineState({ supabase: null, config: cfg, seasonId: "s1" })).enabled, false);
  assert.equal((await loadQuarantineState({ supabase: {}, config: cfg, seasonId: null })).enabled, false);
});

// Minimal PostgREST-agtig double: understøtter select/eq/in/or/order/range.
function fakeSupabase(tables) {
  return {
    from(table) {
      const rows = tables[table] || [];
      // Ægte PostgREST-builders er BÅDE chainable og thenable, også efter
      // .range() — selectAllInChunks påfører `extra` efter range (samme
      // rækkefølge som raceEntryGenerator.selectInChunks). Doublen skal spejle
      // det, ellers tester vi en kontrakt der ikke findes.
      let from = 0;
      let to = Number.MAX_SAFE_INTEGER;
      const q = {
        _rows: rows,
        select() { return q; },
        eq(col, val) { q._rows = q._rows.filter((r) => r[col] === val); return q; },
        in(col, vals) { q._rows = q._rows.filter((r) => vals.includes(r[col])); return q; },
        lt(col, val) { q._rows = q._rows.filter((r) => new Date(r[col]) < new Date(val)); return q; },
        limit(n) { q._rows = q._rows.slice(0, n); return q; },
        or() { return q; },
        order() { return q; },
        range(a, b) { from = a; to = b; return q; },
        maybeSingle() { return Promise.resolve({ data: q._rows[0] ?? null, error: null }); },
        then(resolve, reject) {
          return Promise.resolve({ data: q._rows.slice(from, to + 1), error: null }).then(resolve, reject);
        },
      };
      return q;
    },
  };
}

test("loadQuarantineState: end-to-end — over-kvalificeret nyindkøb bliver blokeret", async () => {
  const poolId = 7;
  const seasonId = "s2";
  // 10 rivaler med peak 38 (så 10.-bedste rival = 38) + 1 nyindkøbt peak 66.
  const rivalRiders = Array.from({ length: 10 }, (_, i) => ({
    id: `rival${i}`, team_id: `rivalteam${i}`, acquired_at: "2026-07-01T00:00:00Z",
    is_academy: false, is_retired: false,
  }));
  const tables = {
    seasons: [{ id: seasonId, start_date: "2026-07-27" }],
    races: [{ id: "race1", league_division_id: poolId, season_id: seasonId }],
    race_stage_schedule: Array.from({ length: 6 }, (_, i) => ({
      race_id: "race1", stage_number: i, game_day: i,
      scheduled_at: new Date(T0 + i * 6 * HOUR).toISOString(),
    })),
    teams: [
      { id: "buyer", league_division_id: poolId },
      ...rivalRiders.map((r) => ({ id: r.team_id, league_division_id: poolId })),
    ],
    riders: [
      { id: "star", team_id: "buyer", acquired_at: new Date(T0 + 6 * HOUR + 1).toISOString(), is_academy: false, is_retired: false },
      ...rivalRiders,
    ],
    rider_derived_abilities: [
      { rider_id: "star", flat: 20, climbing: 66, sprint: 10, time_trial: 30, punch: 20, cobblestone: 10 },
      ...rivalRiders.map((r) => ({ rider_id: r.id, flat: 38, climbing: 10, sprint: 10, time_trial: 10, punch: 10, cobblestone: 10 })),
    ],
  };

  const state = await loadQuarantineState({
    supabase: fakeSupabase(tables),
    config: { scope: "overqualified", raceDays: 3, margin: 10, maxDebutsPerRaceDay: 0 },
    seasonId,
  });

  assert.equal(state.enabled, true);
  const entry = state.byRider.get("star");
  assert.ok(entry, "den over-kvalificerede rytter er i karantæne");
  assert.equal(entry.reason, "overqualified");
  assert.equal(entry.margin, 28);
  // Erhvervet lige efter game_day 1 startede → blokerer dag 2, 3, 4.
  assert.deepEqual(entry.blockedGameDays, [2, 3, 4]);
  assert.equal(entry.releaseGameDay, 5);
  assert.deepEqual([...state.quarantinedIdsByTeam.get("buyer")], ["star"]);
  // Rivalerne er ikke over-kvalificerede og rammes ikke.
  assert.equal(state.byRider.size, 1);
  // Løbs-gaten: blokeret på dag 3, fri på dag 5.
  assert.equal(blockedRiderIdsForRace(state, { game_day_start: 3 }).has("star"), true);
  assert.equal(blockedRiderIdsForRace(state, { game_day_start: 5 }).has("star"), false);
});

test("loadQuarantineState: rytter uden acquired_at + forrige sæsons ejerskab rammes aldrig (scope=all)", async () => {
  const poolId = 7;
  const rivalRiders = Array.from({ length: 10 }, (_, i) => ({
    id: `rival${i}`, team_id: `rivalteam${i}`, acquired_at: "2026-07-01T00:00:00Z",
    is_academy: false, is_retired: false,
  }));
  const tables = {
    seasons: [{ id: "s2", start_date: "2026-07-27" }],
    races: [{ id: "race1", league_division_id: poolId, season_id: "s2" }],
    race_stage_schedule: Array.from({ length: 6 }, (_, i) => ({
      race_id: "race1", stage_number: i, game_day: i,
      scheduled_at: new Date(T0 + i * 6 * HOUR).toISOString(),
    })),
    teams: [{ id: "buyer", league_division_id: poolId }, ...rivalRiders.map((r) => ({ id: r.team_id, league_division_id: poolId }))],
    riders: [
      { id: "star", team_id: "buyer", acquired_at: null, is_academy: false, is_retired: false },
      ...rivalRiders,
    ],
    rider_derived_abilities: [
      { rider_id: "star", flat: 66, climbing: 10, sprint: 10, time_trial: 10, punch: 10, cobblestone: 10 },
      ...rivalRiders.map((r) => ({ rider_id: r.id, flat: 38, climbing: 10, sprint: 10, time_trial: 10, punch: 10, cobblestone: 10 })),
    ],
  };
  const state = await loadQuarantineState({
    supabase: fakeSupabase(tables),
    config: { scope: "all", raceDays: 3, margin: 10, maxDebutsPerRaceDay: 0 },
    seasonId: "s2",
  });
  assert.equal(state.byRider.size, 0);
});
