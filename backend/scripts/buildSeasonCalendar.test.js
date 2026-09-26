// backend/scripts/buildSeasonCalendar.test.js
// #3469 (leverance 4): pr.-tier K-B-kompositions-gate i gatePlan(). FØR denne ændring
// gatede buildSeasonCalendar.js kun SÆSON-AGGREGATET (compositionDrift, #3295) — en
// enkelt tier kunne afvige markant og forsvinde i sæson-gennemsnittet, hvis en anden
// tier afveg den modsatte vej. Ren funktion (gatePlan er DB-fri) → testbar uden Supabase.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  gatePlan, countRaceDependencies, describeSeasonCalendarWriteGate, replaceSeasonCalendarRows,
  scopeRacesToSquad, detectSeniorPoolStructureViolations, runSquadCalendar, loadCutoverPoolRetirement,
} from "./buildSeasonCalendar.js";
import { resolveTargetStructure } from "../lib/calendarTargetStructure.js";
import { computeCompositionStats } from "../lib/calendarCompositionTargets.js";
import {
  evaluateSeasonCalendarWriteGate, RACE_DEPENDENCY_TABLES, dependencyKey,
} from "../lib/seasonCalendarGate.js";

// Minimal, gyldig tier-plan-fixture. `seedRaces` udelades bevidst (null) i de fleste
// tests — det udløser gatePlan's "ingen tier leverede et løbssæt at score realisme på"
// (en forventet, ikke-relateret blocking-post), så testene asserter med `.some()`/
// `.includes()` i stedet for at kræve en tom `blocking`-liste. Kun testen der specifikt
// dækker "alt grønt" bygger ægte seedRaces.
function tierPlan({ tier, stages, seedRaces = null, quotaHit = true, shortfall = 0 }) {
  return {
    tier, calendarViolations: [], quotaHit, shortfall,
    compositionStats: computeCompositionStats([{ stages }]),
    stageOrderStats: null,
    seedRaces,
  };
}

const stagesOf = (profileType, n) => Array.from({ length: n }, () => ({ profile_type: profileType }));

test("gatePlan: en tier der er 100% flad (langt fra K-B's 24%) gates som blocking (#3469, default)", () => {
  const summary = { tiers: [tierPlan({ tier: 4, stages: stagesOf("flat", 56) })] };
  const { blocking, tierCompositionDrift } = gatePlan(summary);

  assert.ok(blocking.some((b) => b.includes("pr.-tier komposition (#3469)") && b.includes("tier 4") && b.includes("flad")), blocking.join(" · "));
  assert.deepEqual(tierCompositionDrift, [], "uden flaget rykkes bruddet ind i blocking, ikke den lempede liste");
});

test("gatePlan: --allow-tier-composition-drift flytter bruddet fra blocking til tierCompositionDrift", () => {
  const summary = { tiers: [tierPlan({ tier: 4, stages: stagesOf("flat", 56) })] };
  const { blocking, tierCompositionDrift } = gatePlan(summary, { allowTierCompositionDrift: true });

  assert.ok(!blocking.some((b) => b.includes("pr.-tier komposition")), blocking.join(" · "));
  assert.ok(tierCompositionDrift.some((v) => v.includes("tier 4") && v.includes("flad")), tierCompositionDrift.join(" · "));
});

test("gatePlan: en tier der rammer K-B inden for tolerancen giver INGEN pr.-tier-brud", () => {
  // K-B (ACTIVE_TARGET): flad 24 · kuperet 33 · bjerg 28 · ITT 10 · brosten 5 · TTT 0
  // (brosten rettet 6 → 5 31/8, #4103 — +1 pp lagt på kuperet, se calendarCompositionTargets.js).
  // Byg 100 løbsdage der matcher profilen præcist.
  const stages = [
    ...stagesOf("flat", 24), ...stagesOf("hilly", 33), ...stagesOf("mountain", 28),
    ...stagesOf("itt", 10), ...stagesOf("cobbles", 5),
  ];
  const summary = { tiers: [tierPlan({ tier: 3, stages })] };
  const { blocking, tierCompositionDrift } = gatePlan(summary);

  assert.ok(!blocking.some((b) => b.includes("pr.-tier komposition")), blocking.join(" · "));
  assert.deepEqual(tierCompositionDrift, []);
});

test("gatePlan: pr.-tier-gaten fanger en afvigelse SÆSON-AGGREGATET ville have skjult", () => {
  // Tier A 100% flad, tier B 100% bjerg — season-aggregatet (vægtet ligeligt her, 56+56)
  // lander midt imellem og kan sagtens ramme K-B's ±tolerance, men INGEN af de to tiers
  // gør det hver for sig.
  const summary = {
    tiers: [
      tierPlan({ tier: 3, stages: stagesOf("flat", 56) }),
      tierPlan({ tier: 4, stages: stagesOf("mountain", 56) }),
    ],
  };
  const { blocking } = gatePlan(summary);
  assert.ok(blocking.some((b) => b.includes("tier 3") && b.includes("pr.-tier komposition")), blocking.join(" · "));
  assert.ok(blocking.some((b) => b.includes("tier 4") && b.includes("pr.-tier komposition")), blocking.join(" · "));
});

test("gatePlan: pr.-tier-tolerancen er data (TIER_COMPOSITION_TOLERANCE_PP), ikke kun størrelses-formlen", () => {
  // Tier 4's tabel-tolerance er 10pp (målt, se calendarCompositionTargets.js). En lille
  // tier (8 løbsdage) hvor ÉT løb flytter langt mere end ±2pp skal derfor bestå — enten
  // via tabellen ALENE eller via det generiske applyMinRaceDayTolerance-sikkerhedsnet
  // under den (begge holder her; testen dækker den SAMLEDE kontrakt, ikke hvilken af de
  // to der vandt).
  const stages = [...stagesOf("flat", 2), ...stagesOf("hilly", 3), ...stagesOf("mountain", 2), ...stagesOf("itt", 1)];
  const summary = { tiers: [tierPlan({ tier: 4, stages })] };
  const { blocking } = gatePlan(summary);
  assert.ok(!blocking.some((b) => b.includes("pr.-tier komposition")), `lille stikprøve skal bestå under tier 4's 10pp-tolerance: ${blocking.join(" · ")}`);
});

test("gatePlan: tomme tiers (0 løbsdage) rammer den EKSISTERENDE 'tom kalender'-gate, ikke kompositions-gaten", () => {
  const summary = { tiers: [{ tier: 4, calendarViolations: [], quotaHit: false, shortfall: 56, compositionStats: computeCompositionStats([]), stageOrderStats: null, seedRaces: null }] };
  const { blocking } = gatePlan(summary);
  assert.ok(blocking.some((b) => b.includes("0 løbsdage i planen")), blocking.join(" · "));
  assert.ok(!blocking.some((b) => b.includes("pr.-tier komposition")), "0-løbsdages-tieren continue'r FØR kompositions-checket rammes");
});

// ── #3469 (8/8, ejer-beslutning): tolerancen skal bestå DAGENS plan uden flag, men
// stadig fange en NY regression — de to tests herunder er selve beviset. ─────────────
//
// Tallene er de PRÆCISE pr.-tier-tal målt på den faktiske S3-plan
// (node scripts/buildSeasonCalendar.js --season 3 --first-day 2026-08-24, 2026-08-08) —
// samme grundlag TIER_COMPOSITION_TOLERANCE_PP er kalibreret mod.
test("gatePlan: den MÅLTE S3-plans pr.-tier-afvigelser består UDEN --allow-tier-composition-drift", () => {
  const summary = {
    tiers: [
      tierPlan({ tier: 1, stages: [...stagesOf("flat", 28), ...stagesOf("hilly", 52), ...stagesOf("mountain", 41), ...stagesOf("itt", 16), ...stagesOf("cobbles", 3)] }),
      tierPlan({ tier: 2, stages: [...stagesOf("flat", 24), ...stagesOf("hilly", 35), ...stagesOf("mountain", 31), ...stagesOf("itt", 11), ...stagesOf("cobbles", 10)] }),
      tierPlan({ tier: 3, stages: [...stagesOf("flat", 19), ...stagesOf("hilly", 28), ...stagesOf("mountain", 18), ...stagesOf("itt", 9), ...stagesOf("cobbles", 8)] }),
      tierPlan({ tier: 4, stages: [...stagesOf("flat", 18), ...stagesOf("hilly", 13), ...stagesOf("mountain", 19), ...stagesOf("itt", 3), ...stagesOf("cobbles", 3)] }),
    ],
  };
  const { blocking, tierCompositionDrift } = gatePlan(summary);
  assert.ok(!blocking.some((b) => b.includes("pr.-tier komposition")), `dagens plan skal bestå uden flag: ${blocking.join(" · ")}`);
  assert.deepEqual(tierCompositionDrift, []);
});

test("gatePlan: en SYNTETISK +8pp-afvigelse på en tier fejler stadig (gaten er ikke tandløs)", () => {
  // Tier 2's tabel-tolerance er 5pp. +8pp flad / -8pp kuperet er begge over den — gaten
  // skal stadig blokere en regression der er VÆRRE end det målte grundlag.
  const stages = [...stagesOf("flat", 32), ...stagesOf("hilly", 24), ...stagesOf("mountain", 28), ...stagesOf("itt", 10), ...stagesOf("cobbles", 6)];
  const summary = { tiers: [tierPlan({ tier: 2, stages })] };
  const { blocking } = gatePlan(summary);
  assert.ok(blocking.some((b) => b.includes("tier 2") && b.includes("pr.-tier komposition") && b.includes("flad")), blocking.join(" · "));
});

// ═══════════════════════════════════════════════════════════════════════════════
// #5405 — den nye §2c: fri regenerering indtil sæsonen er aktiv, derefter låst
// ═══════════════════════════════════════════════════════════════════════════════
//
// Selve afgørelserne er rene og testes i lib/seasonCalendarGate.test.js. Her testes
// CLI-lagets to ting: at hver gate-kode HAR en dansk forklaring, og at I/O-stien tæller
// og sletter det den siger — mod en fake Supabase, så ingen test rører en database.

test("#5405: hver skrive-gate-kode har en forklaring — ingen gren printer 'undefined'", () => {
  const cases = [
    { seasonRow: { status: "upcoming" } }, { seasonRow: { status: "active" } },
    { seasonRow: { status: "completed" } }, { seasonRow: { status: "hvad-som-helst" } },
    { seasonRow: null },
  ];
  const seen = new Set();
  for (const c of cases) {
    const gate = evaluateSeasonCalendarWriteGate(c);
    const text = describeSeasonCalendarWriteGate(gate, 4);
    assert.ok(text.length > 20, `for kort forklaring for ${gate.code}: ${text}`);
    assert.doesNotMatch(text, /undefined|\[object/, `${gate.code} lækker en intern værdi: ${text}`);
    assert.match(text, /sæson 4/, `${gate.code} nævner ikke sæsonen: ${text}`);
    seen.add(gate.code);
  }
  assert.equal(seen.size, 5, "forventede alle fem gate-koder dækket");
});

test("#5405: en UKENDT gate-kode beskrives som et NEJ, ikke som tomhed", () => {
  // En fremtidig gren nogen glemte at beskrive må ikke ligne et blankt felt.
  const text = describeSeasonCalendarWriteGate({ code: "noget_nyt" }, 4);
  assert.match(text, /NEJ/);
  assert.doesNotMatch(text, /undefined/);
});

// ── Fake Supabase ────────────────────────────────────────────────────────────
// Kun de kald buildSeasonCalendar faktisk laver. Hver skrivning logges, så en test kan
// bevise at en tørkørsel IKKE skrev noget — ikke bare at den ikke kastede.
function fakeSupabase({ rowsByTable = {}, countOverrides = {}, failCountFor = null } = {}) {
  const writes = [];
  const rows = (t) => rowsByTable[t] ?? [];

  // #5644: builderen er en thenable, der først afgøres når den awaites, så filtre kan kædes
  // (.eq("season_id").or(senior-filteret) / .eq("squad", ...)). Hver skrivning logger ALLE
  // sine filtre; `column`/`value`/`ids` er det første filter (som før #5644).
  function builder(table) {
    const state = { table, count: false, op: null, filters: [] };
    const settle = () => {
      const first = state.filters[0];
      if (state.op) {
        const w = { table, kind: state.op.kind, filters: state.filters };
        if (first?.type === "in") { w.column = first.col; w.ids = first.vals; }
        if (first?.type === "eq") { w.column = first.col; w.value = first.val; }
        writes.push(w);
        return { error: null };
      }
      if (state.count) {
        const key = `${table}.${first?.col}`;
        if (failCountFor === key) return { count: null, error: { message: "boom" } };
        return { count: countOverrides[key] ?? 0, error: null };
      }
      return { data: rows(table), error: null };
    };
    const q = {
      select(_cols, opts) { state.count = Boolean(opts?.count); return q; },
      update(patch) { state.op = { kind: "update", patch }; return q; },
      delete() { state.op = { kind: "delete" }; return q; },
      insert(payload) { writes.push({ table, kind: "insert", payload }); return Promise.resolve({ error: null }); },
      order() { return q; },
      limit() { return q; },
      range(from, to) { return Promise.resolve({ data: rows(table).slice(from, to + 1), error: null }); },
      in(col, vals) { state.filters.push({ type: "in", col, vals }); return q; },
      eq(col, val) { state.filters.push({ type: "eq", col, val }); return q; },
      or(expr) { state.filters.push({ type: "or", expr }); return q; },
      maybeSingle() { return Promise.resolve({ data: rows(table)[0] ?? null, error: null }); },
      then(res, rej) { return Promise.resolve(settle()).then(res, rej); },
    };
    return q;
  }
  return { from: builder, writes };
}

const raceIds = ["r1", "r2", "r3"];

test("#5405 countRaceDependencies: tæller HVER FK-tabel i katalogen, også dem på 0", () => {
  const supabase = fakeSupabase({ countOverrides: { "race_entries.race_id": 4, "race_results.race_id": 2 } });
  return countRaceDependencies({ supabase, raceIds }).then((counts) => {
    for (const dep of RACE_DEPENDENCY_TABLES) {
      assert.ok(dependencyKey(dep) in counts, `${dependencyKey(dep)} blev ikke talt`);
    }
    assert.equal(counts["race_entries.race_id"], 4);
    assert.equal(counts["race_results.race_id"], 2);
    assert.equal(counts["race_incidents.race_id"], 0);
    assert.equal(supabase.writes.length, 0, "tælling må ALDRIG skrive");
  });
});

test("#5405 countRaceDependencies: uden løb er alt 0 og der laves ingen forespørgsler", () => {
  const supabase = fakeSupabase();
  return countRaceDependencies({ supabase, raceIds: [] }).then((counts) => {
    assert.equal(Object.values(counts).every((c) => c === 0), true);
    assert.equal(supabase.writes.length, 0);
  });
});

test("#5405 countRaceDependencies: en FEJLET tælling bliver NaN, ikke 0", () => {
  // Det er dén værdi erstatnings-gaten nægter fail-closed på. Blev den 0, ville en
  // afvist læsning ligne "ingen data at miste" — den dyreste form for stilhed.
  const supabase = fakeSupabase({ failCountFor: "race_entries.race_id" });
  return countRaceDependencies({ supabase, raceIds }).then((counts) => {
    assert.ok(Number.isNaN(counts["race_entries.race_id"]));
    assert.equal(counts["race_results.race_id"], 0);
  });
});

test("#5405 replaceSeasonCalendarRows: snapshot FØR sletning, børn før races, post-verify 0", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cz-5405-"));
  try {
    const races = raceIds.map((id) => ({ id, name: `løb ${id}`, league_division_id: 1, status: "scheduled" }));
    const supabase = fakeSupabase({
      rowsByTable: {
        race_stage_profiles: [{ race_id: "r1", stage_number: 1 }],
        race_stage_schedule: [{ race_id: "r1", stage_number: 1 }],
        teams: [{ id: "t1", my_result_seen_race_id: "r1" }],
      },
      countOverrides: { "races.season_id": 0 }, // post-verify: 0 tilbage
    });

    const res = await replaceSeasonCalendarRows({
      supabase, seasonId: "season-4", seasonNumber: 4, races, snapshotDir: dir,
    });

    // 1) Snapshottet findes og indeholder dét der blev slettet — ellers er der ingen rollback.
    const files = readdirSync(dir);
    assert.equal(files.length, 1, `forventede ét snapshot, fandt ${files.join(", ")}`);
    const snap = JSON.parse(readFileSync(join(dir, files[0]), "utf8"));
    assert.deepEqual(snap.raceIds, raceIds);
    assert.equal(snap.races.length, 3);
    assert.equal(snap.race_stage_profiles.length, 1);
    assert.equal(snap.teams_my_result_seen_race_id_before.length, 1);
    assert.equal(res.deletedRaces, 3);

    // 2) Rækkefølgen: UI-state nulles, børn slettes, races slettes SIDST og scopet på season_id.
    const kinds = supabase.writes.map((w) => `${w.kind}:${w.table}`);
    assert.deepEqual(kinds, [
      "update:teams",
      "delete:race_stage_schedule",
      "delete:race_stage_profiles",
      "delete:races",
    ], kinds.join(" → "));
    const racesDelete = supabase.writes.at(-1);
    assert.equal(racesDelete.column, "season_id");
    assert.equal(racesDelete.value, "season-4");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("#5405 replaceSeasonCalendarRows: post-verify med løb tilbage KASTER (ingen materialisering ovenpå)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cz-5405-"));
  try {
    const supabase = fakeSupabase({ countOverrides: { "races.season_id": 2 } });
    await assert.rejects(
      replaceSeasonCalendarRows({
        supabase, seasonId: "season-4", seasonNumber: 4,
        races: raceIds.map((id) => ({ id })), snapshotDir: dir,
      }),
      /efterlod 2 senior-løb/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("#5405 replaceSeasonCalendarRows: 0 løb er en no-op — intet snapshot, ingen skrivning", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cz-5405-"));
  try {
    const supabase = fakeSupabase();
    const res = await replaceSeasonCalendarRows({ supabase, seasonId: "s", seasonNumber: 4, races: [], snapshotDir: dir });
    assert.equal(res.deletedRaces, 0);
    assert.equal(res.snapshotPath, null);
    assert.equal(supabase.writes.length, 0);
    assert.deepEqual(readdirSync(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── #5644 (risiko 6) · --replace-existing og post-verify er pr. TRUP ─────────────────

test("#5644 replaceSeasonCalendarRows --squad u23: sletter KUN U23-løb (season_id + squad), snapshot mærket u23", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cz-5644-"));
  try {
    const supabase = fakeSupabase({ countOverrides: { "races.season_id": 0 } });
    await replaceSeasonCalendarRows({
      supabase, seasonId: "season-4", seasonNumber: 4, races: raceIds.map((id) => ({ id })), snapshotDir: dir, squad: "u23",
    });
    const racesDelete = supabase.writes.find((w) => w.kind === "delete" && w.table === "races");
    assert.deepEqual(racesDelete.filters, [
      { type: "eq", col: "season_id", val: "season-4" },
      { type: "eq", col: "squad", val: "u23" },
      { type: "in", col: "id", vals: raceIds },
    ], "sletningen er scopet til sæson OG trup — seniorløbene står");
    const [file] = readdirSync(dir);
    assert.match(file, /season4-u23-/);
    assert.equal(JSON.parse(readFileSync(join(dir, file), "utf8")).squad, "u23");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("#5644 replaceSeasonCalendarRows senior (default): sletter kun seniorløb, ungdomsløbene står", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cz-5644-"));
  try {
    const supabase = fakeSupabase({ countOverrides: { "races.season_id": 0 } });
    await replaceSeasonCalendarRows({ supabase, seasonId: "season-4", seasonNumber: 4, races: raceIds.map((id) => ({ id })), snapshotDir: dir });
    const racesDelete = supabase.writes.find((w) => w.kind === "delete" && w.table === "races");
    assert.deepEqual(racesDelete.filters, [
      { type: "eq", col: "season_id", val: "season-4" },
      { type: "or", expr: "squad.is.null,squad.eq.senior" },
      { type: "in", col: "id", vals: raceIds },
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("#5644 scopeRacesToSquad: ukendt trup kastes (en tastefejl må aldrig slette seniorløb)", () => {
  const supabase = fakeSupabase();
  assert.throws(() => scopeRacesToSquad(supabase.from("races").delete().eq("season_id", "s"), "U23"), /ukendt trup/);
});

// ── #5644 / #4592 A3 · strukturvagten: 1/2/4/4 fra S4 ─────────────────────────────

const planWithPools = (counts) => Object.entries(counts).map(([tier, n]) => ({ tier: Number(tier), pools: Array.from({ length: n }, (_, i) => ({ leagueDivisionId: i })) }));

test("#5644 detectSeniorPoolStructureViolations: S4 med 8 D4-puljer (E-H ikke pensioneret) blokerer; 1/2/4/4 er ren", () => {
  const bad = detectSeniorPoolStructureViolations({ planTiers: planWithPools({ 1: 1, 2: 2, 3: 4, 4: 8 }), seasonNumber: 4 });
  assert.equal(bad.length, 1);
  assert.match(bad[0], /D4: 8 puljer/);
  assert.deepEqual(detectSeniorPoolStructureViolations({ planTiers: planWithPools({ 1: 1, 2: 2, 3: 4, 4: 4 }), seasonNumber: 4 }), []);
  const missingD3 = detectSeniorPoolStructureViolations({ planTiers: planWithPools({ 1: 1, 2: 2, 3: 3, 4: 4 }), seasonNumber: 4 });
  assert.match(missingD3[0], /D3: 3 puljer/);
  assert.deepEqual(detectSeniorPoolStructureViolations({ planTiers: planWithPools({ 1: 1, 2: 2, 3: 4, 4: 8 }), seasonNumber: 3 }), [], "før S4 gælder vagten ikke");
});

// ── #5795 · S4-kalenderen før pensioneringen (--target-structure s4) ──────────────

const d4Pool = (i, retired = null) => ({ id: 8 + i, tier: 4, pool_index: i, label: `Division 4 — ${"ABCDEFGH"[i]}`, squad: "senior", retired_at: retired });

test("#5795 loadCutoverPoolRetirement: læser puljerne read-only og udpeger D4 E-H; intet skrives", async () => {
  const league_divisions = [
    { id: 1, tier: 1, pool_index: 0, label: "Division 1", squad: "senior", retired_at: null },
    ...[7, 6, 5, 4, 3, 2, 1, 0].map((i) => d4Pool(i)),
  ];
  const supabase = fakeSupabase({ rowsByTable: { league_divisions } });
  const cutover = await loadCutoverPoolRetirement({ supabase, structure: resolveTargetStructure("s4") });
  assert.deepEqual(cutover.retire.map((p) => p.label), ["Division 4 — E", "Division 4 — F", "Division 4 — G", "Division 4 — H"]);
  assert.deepEqual(supabase.writes, [], "målstrukturen skriver aldrig (retired_at røres ikke)");
});

test("#5795 strukturvagten: planen med målstrukturen (D4 = 4) er ren; uden flaget blokerer den som før", () => {
  const withTarget = detectSeniorPoolStructureViolations({ planTiers: planWithPools({ 1: 1, 2: 2, 3: 4, 4: 4 }), seasonNumber: 4 });
  assert.deepEqual(withTarget, []);
  const withoutTarget = detectSeniorPoolStructureViolations({ planTiers: planWithPools({ 1: 1, 2: 2, 3: 4, 4: 8 }), seasonNumber: 4 });
  assert.match(withoutTarget[0], /--target-structure s4/, "bruddet peger på den nye vej");
});

// ── #5644 (Y5) · runSquadCalendar ─────────────────────────────────────────────────

const squadPlan = (violations = []) => ({
  tiers: [{ tier: 1, calendarViolations: violations, coverageMeasurements: [] }],
  planTiers: [{ tier: 1, pools: [{}, {}], raceCount: 8, weeklyRaceStarts: [2, 2, 2, 2], racesPerWeek: { min: 1, max: 2 }, racingDates: 14, realDays: 28, raceDayAxisLength: 140, trainingGameDayCount: 126, calendarViolations: violations }],
});

async function withExitCode(fn) {
  const saved = process.exitCode;
  try { return await fn(); } finally { process.exitCode = saved; }
}

test("#5644 runSquadCalendar dry-run: uden seniorkalender blokerer den, og intet skrives", () => withExitCode(async () => {
  const supabase = fakeSupabase({ countOverrides: { "races.season_id": 0 } });
  const res = await runSquadCalendar({
    supabase, squad: "u23", seasonId: "season-4", seasonNumber: 4, seasonRow: { status: "upcoming" },
    writeGate: { allowed: true, code: "upcoming" }, replacement: { mode: "fresh" }, existingRaces: [],
    apply: false, plan: squadPlan(), log: () => {}, logError: () => {},
  });
  assert.ok(res.blocking.some((b) => b.includes("ingen seniorkalender")));
  assert.equal(process.exitCode, 1);
  assert.equal(supabase.writes.length, 0);
}));

test("#5644 runSquadCalendar --apply --replace-existing: sletter kun truppens løb og materialiserer med squad", () => withExitCode(async () => {
  const dir = mkdtempSync(join(tmpdir(), "cz-5644-"));
  try {
    // Seniortællingen (season_id + senior-or) = 500; post-verify-tællingen af truppen bruger
    // samme nøgle i fake'en, så den svarer også 500 (> 0 = verificeret).
    const supabase = fakeSupabase({ countOverrides: { "races.season_id": 500 } });
    const calls = [];
    const materialize = async (args) => { calls.push(args); return { racesInserted: 72, stageProfiles: 0, stageSchedules: 0 }; };
    // Erstatningens post-verify (0 tilbage) kører mod en fake med 0: derfor to fakes.
    const replaceFake = fakeSupabase({ countOverrides: { "races.season_id": 0 } });
    let n = 0;
    const routed = { from: (t) => (t === "races" && n++ >= 1 && n <= 3 ? replaceFake.from(t) : supabase.from(t)) };
    await runSquadCalendar({
      supabase: routed, squad: "u23", seasonId: "season-4", seasonNumber: 4, seasonRow: { status: "upcoming" },
      writeGate: { allowed: true, code: "upcoming" }, replacement: { mode: "replace" },
      existingRaces: [{ id: "u1" }, { id: "u2" }], apply: true, replaceExisting: true, snapshotDir: dir,
      firstDay: "2026-09-28", window: { derived: false }, plan: squadPlan(), materialize,
      materializeArgs: { realDays: 28 }, log: () => {}, logError: () => {},
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].squad, "u23");
    assert.equal(calls[0].dryRun, false);
    const racesDelete = replaceFake.writes.find((w) => w.kind === "delete" && w.table === "races");
    assert.ok(racesDelete.filters.some((f) => f.type === "eq" && f.col === "squad" && f.val === "u23"), "kun U23-løb slettes");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}));
