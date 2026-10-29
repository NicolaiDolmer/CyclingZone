// #2557: tests for den ugentlige motor-drift-rapport. Kun syntetiske fixtures og
// opfundne graenser (hard rule 17: ingen rigtige balance-tal i repoet).
import test from "node:test";
import assert from "node:assert/strict";
import {
  GROUPS, abandonCategory, alarmText, bandStatus, buildFacts, buildPayloads, computeGroupMetrics, evaluate, main,
  makeReadOnlyClient, parseThresholds, raceGroupOfRace, renderReport, splitReport, summaryLine, windowOf, missingEnv, fetchRaw,
} from "./weeklyEngineDrift2557.mjs";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const race = (id, over = {}) => ({ id, stages: 1, race_class: "Class1", squad: "senior", engine_rules_revision: "rev_a", ...over });
/** Endagsloeb persisteres KUN som gc-raekker (raceRunner.js), aldrig stage. */
const gcRow = (raceId, stage, rank, rider, extra = {}) => row(raceId, stage, rank, rider, { result_type: "gc", ...extra });
const row = (raceId, stage, rank, rider, extra = {}) => ({ id: `${raceId}-${stage}-${rank}-${extra.result_type ?? "stage"}`, race_id: raceId, stage_number: stage, result_type: "stage", rank, rider_id: rider, team_id: `t-${rider}`, in_breakaway: false, ...extra });
/** Fast ur: fixtures ligger 20/10, vinduet 19/10-26/10 (aldrig vaeguret, AGENTS.md). */
const NOW = new Date("2026-10-26T06:00:00Z");
const sched = (raceId, stage) => ({ race_id: raceId, stage_number: stage, scheduled_at: "2026-10-20T10:00:00Z" });

/** Favoritten er altid rytteren med "fav" i id'et. */
const observe = ({ results }) => ({ favoriteId: results.find((r) => String(r.rider_id).startsWith("fav"))?.rider_id ?? null });

const THRESHOLDS_JSON = JSON.stringify({
  weeklyEngineDrift: {
    minStages: 2,
    groups: {
      one_day: { breakawayWinShare: { max: 0.5 }, favoriteWinShare: { min: 0.2, max: 0.8 }, abandonShare: { max: 0.3 } },
      gt: { gcWinnerFromBreakawayShare: { max: 0.5 } },
    },
  },
});

// ── Gruppering og udgaaelser ─────────────────────────────────────────────────

test("raceGroupOfRace: U23/junior foerst, saa monument, ellers etapeantal", () => {
  assert.equal(raceGroupOfRace(race("a", { stages: 1 })), "one_day");
  assert.equal(raceGroupOfRace(race("a", { stages: 1, race_class: "Monuments" })), "monument");
  assert.equal(raceGroupOfRace(race("a", { stages: 1, race_class: "Monuments", squad: "u23" })), "u23_junior");
  assert.equal(raceGroupOfRace(race("a", { stages: 5, squad: "junior" })), "u23_junior");
  assert.equal(raceGroupOfRace(race("a", { stages: 2 })), "short_stage_race");
  assert.equal(raceGroupOfRace(race("a", { stages: 8 })), "short_stage_race");
  assert.equal(raceGroupOfRace(race("a", { stages: 9 })), "other_stage_race");
  assert.equal(raceGroupOfRace(race("a", { stages: 14 })), "other_stage_race");
  assert.equal(raceGroupOfRace(race("a", { stages: 21 })), "gt");
  assert.equal(raceGroupOfRace({ id: "x" }), "one_day");
});

test("abandonCategory: styrt, sygdom/skade, traethed, mekanisk", () => {
  assert.equal(abandonCategory("crash"), "crash");
  assert.equal(abandonCategory("injury"), "illness");
  assert.equal(abandonCategory("illness"), "illness");
  assert.equal(abandonCategory("time_limit"), "fatigue");
  assert.equal(abandonCategory("mechanical"), "mechanical");
});

// ── Taerskler ────────────────────────────────────────────────────────────────

test("parseThresholds: gyldig fil", () => {
  const t = parseThresholds(THRESHOLDS_JSON);
  assert.equal(t.minStages, 2);
  assert.deepEqual(t.groups.one_day.bands.breakawayWinShare, { max: 0.5 });
});

test("parseThresholds: fail closed uden vaerdier i fejlen", () => {
  assert.throws(() => parseThresholds("ikke json {"), /ikke gyldig JSON/);
  assert.throws(() => parseThresholds("{}"), /mangler sektionen/);
  assert.throws(() => parseThresholds(JSON.stringify({ weeklyEngineDrift: { groups: {} } })), /minStages/);
  assert.throws(() => parseThresholds(JSON.stringify({ weeklyEngineDrift: { minStages: 1, groups: { ukendt: {} } } })), /ukendt loebsgruppe/);
  assert.throws(() => parseThresholds(JSON.stringify({ weeklyEngineDrift: { minStages: 1, groups: { gt: { ukendtMaal: { max: 0.123456 } } } } })), (e) => /ukendt maal/.test(e.message) && !e.message.includes("0.123456"));
  assert.throws(() => parseThresholds(JSON.stringify({ weeklyEngineDrift: { minStages: 1, groups: { gt: { crashShare: {} } } } })), /min og max/);
  assert.throws(() => parseThresholds(JSON.stringify({ weeklyEngineDrift: { minStages: 1, groups: { gt: { crashShare: { max: "x" } } } } })), /ikke er et tal/);
});

test("bandStatus", () => {
  assert.equal(bandStatus(0.4, { min: 0.2, max: 0.5 }), "OK");
  assert.equal(bandStatus(0.1, { min: 0.2 }), "DEVIATION");
  assert.equal(bandStatus(0.6, { max: 0.5 }), "DEVIATION");
  assert.equal(bandStatus(null, { max: 0.5 }), "NODATA");
});

// ── Fakta og maal ────────────────────────────────────────────────────────────

function oneDayRaw() {
  // Tre endagsloeb. Loeb 1: favoritten vinder. Loeb 2: en udbryder vinder, favoritten er i udbruddet. Loeb 3: en anden vinder.
  return {
    schedule: [sched("r1", 1), sched("r2", 1), sched("r3", 1), sched("r9", 1)],
    races: [race("r1"), race("r2"), race("r3"), race("r9")],
    profiles: [
      { race_id: "r1", stage_number: 1, profile_type: "flat", finale_type: "flat_sprint" },
      { race_id: "r2", stage_number: 1, profile_type: "hilly", finale_type: "punch" },
      { race_id: "r3", stage_number: 1, profile_type: "itt", finale_type: null },
    ],
    results: [
      gcRow("r1", 1, 1, "fav1"), gcRow("r1", 1, 2, "b"), gcRow("r1", 1, 3, "c"),
      gcRow("r2", 1, 1, "esc", { in_breakaway: true }), gcRow("r2", 1, 2, "fav2", { in_breakaway: true }), gcRow("r2", 1, 3, "d"),
      gcRow("r3", 1, 1, "tt"), gcRow("r3", 1, 2, "fav3"),
      // r9 har ingen resultater endnu: tæller ikke
    ],
    incidents: [
      { race_id: "r1", stage_number: 1, rider_id: "x1", kind: "crash", outcome: "abandon" },
      { race_id: "r1", stage_number: 1, rider_id: "x2", kind: "time_limit", outcome: "abandon" },
      { race_id: "r1", stage_number: 1, rider_id: "x1", kind: "crash", outcome: "abandon" }, // dublet tæller en gang
      { race_id: "r2", stage_number: 1, rider_id: "x3", kind: "illness", outcome: "abandon" },
      { race_id: "r2", stage_number: 1, rider_id: "d", kind: "crash", outcome: "abandon" }, // finishede: tæller ikke
      { race_id: "r2", stage_number: 1, rider_id: "x4", kind: "crash", outcome: "time_loss" }, // ikke en udgaaelse
    ],
  };
}

test("buildFacts: kun afviklede etaper, felt = finishere + udgaaede, favorit fra observeren", () => {
  const facts = buildFacts(oneDayRaw(), { observe });
  assert.equal(facts.stages.length, 3);
  const r1 = facts.stages.find((s) => s.raceId === "r1");
  assert.equal(r1.starters, 5);
  assert.deepEqual(r1.abandons, { crash: 1, illness: 0, fatigue: 1, mechanical: 0 });
  assert.equal(r1.favoriteWon, true);
  const r2 = facts.stages.find((s) => s.raceId === "r2");
  assert.equal(r2.winnerInBreakaway, true);
  assert.equal(r2.favoriteInBreakaway, true);
  assert.equal(r2.favoriteWon, false);
  assert.equal(r2.starters, 4);
  assert.equal(facts.stages.find((s) => s.raceId === "r3").timeTrial, true);
});

test("computeGroupMetrics: tidskoersler holdes ude, andele og bedste rytters sejrsandel", () => {
  const m = computeGroupMetrics(buildFacts(oneDayRaw(), { observe })).one_day;
  assert.equal(m.stages, 2);
  assert.equal(m.values.breakawayWinShare, 0.5);
  assert.equal(m.values.favoriteWinShare, 0.5);
  assert.equal(m.values.favoriteInBreakawayShare, 0.5);
  assert.equal(m.values.topRiderWinShare, 0.5);
  assert.ok(Math.abs(m.values.abandonShare - 3 / 9) < 1e-9);
  assert.ok(Math.abs(m.values.crashShare - 1 / 9) < 1e-9);
  assert.ok(Math.abs(m.values.illnessShare - 1 / 9) < 1e-9);
  assert.ok(Math.abs(m.values.fatigueShare - 1 / 9) < 1e-9);
  assert.equal(m.values.gcWinnerFromBreakawayShare, null);
  assert.deepEqual(m.revisions, { rev_a: 2 });
});

test("computeGroupMetrics: ukendt favorit (ingen evner) tæller ikke i favorit-andelene", () => {
  const m = computeGroupMetrics(buildFacts(oneDayRaw(), { observe: () => null })).one_day;
  assert.equal(m.knownFavoriteStages, 0);
  assert.equal(m.values.favoriteWinShare, null);
  assert.equal(m.values.breakawayWinShare, 0.5);
});

function stageRaceRaw({ gcWinnerFromBreak }) {
  const rows = [];
  for (let s = 1; s <= 3; s += 1) {
    rows.push(row("sr", s, 1, s === 2 ? "gcw" : `w${s}`, { in_breakaway: s === 2 && gcWinnerFromBreak }));
    rows.push(row("sr", s, 2, "z"));
    rows.push(row("sr", s, 3, "gcw2"));
  }
  rows.push(row("sr", 3, 1, "gcw", { result_type: "gc" }), row("sr", 3, 2, "z", { result_type: "gc" }));
  return {
    schedule: [sched("sr", 1), sched("sr", 2), sched("sr", 3)],
    races: [race("sr", { stages: 3 })],
    profiles: [], incidents: [], results: rows,
  };
}

test("GC-vinder fra udbrud: kun afsluttede etapeloeb, vinderen skal have vundet en etape fra udbrud", () => {
  const yes = computeGroupMetrics(buildFacts(stageRaceRaw({ gcWinnerFromBreak: true }), { observe })).short_stage_race;
  assert.equal(yes.gcRaces, 1);
  assert.equal(yes.values.gcWinnerFromBreakawayShare, 1);
  const no = computeGroupMetrics(buildFacts(stageRaceRaw({ gcWinnerFromBreak: false }), { observe })).short_stage_race;
  assert.equal(no.values.gcWinnerFromBreakawayShare, 0);
  assert.equal(no.stages, 3);
});

test("endagsloeb og monumenter med kun gc-raekker (persisteringsformatet) taelles som etaper", () => {
  const raw = {
    schedule: [sched("m1", 1), sched("o1", 1)],
    races: [race("m1", { race_class: "Monuments" }), race("o1")],
    profiles: [],
    incidents: [],
    results: [gcRow("m1", 1, 1, "esc", { in_breakaway: true }), gcRow("m1", 1, 2, "fav1"), gcRow("o1", 1, 1, "fav2"), gcRow("o1", 1, 2, "b")],
  };
  const m = computeGroupMetrics(buildFacts(raw, { observe }));
  assert.equal(m.monument.stages, 1);
  assert.equal(m.monument.values.breakawayWinShare, 1);
  assert.equal(m.monument.values.favoriteWinShare, 0);
  assert.equal(m.one_day.stages, 1);
  assert.equal(m.one_day.values.favoriteWinShare, 1);
  // Ingen GC-dom for endagsloeb.
  assert.equal(m.monument.gcRaces, 0);
});

test("endagsloeb med baade stage- og gc-raekker taelles kun en gang (stage-raekkerne bruges)", () => {
  const raw = {
    schedule: [sched("d1", 1)],
    races: [race("d1")],
    profiles: [],
    incidents: [],
    results: [row("d1", 1, 1, "fav1"), row("d1", 1, 2, "b"), gcRow("d1", 1, 1, "fav1"), gcRow("d1", 1, 2, "b")],
  };
  const facts = buildFacts(raw, { observe });
  assert.equal(facts.stages.length, 1);
  assert.equal(facts.stages[0].starters, 2);
});

test("fetchRaw: evner hentes ogsaa for ryttere der kun staar i gc-raekker", async () => {
  const raw = oneDayRaw();
  const full = await fetchRaw(fakeDb({ ...raw, abilities: [{ rider_id: "fav1", tempo: 1 }, { rider_id: "ukendt", tempo: 1 }] }), { since: "2026-10-19T00:00:00Z", until: "2026-10-27T00:00:00Z", abilityKeys: ["tempo"] });
  assert.deepEqual(full.abilityRows.map((a) => a.rider_id), ["fav1"]);
});

test("etapeloeb hvor sidste etape ikke laa i vinduet eller mangler etaper, er ikke afsluttet", () => {
  const raw = stageRaceRaw({ gcWinnerFromBreak: true });
  const noLast = { ...raw, schedule: raw.schedule.slice(0, 2) };
  assert.equal(buildFacts(noLast, { observe }).races.length, 0);
  const missingStage = { ...raw, results: raw.results.filter((r) => r.stage_number !== 1 || r.result_type === "gc") };
  assert.equal(buildFacts(missingStage, { observe }).races.length, 0);
});

// ── Domme ────────────────────────────────────────────────────────────────────

test("evaluate: OK, afvigelse, for lidt data og info", () => {
  const t = parseThresholds(THRESHOLDS_JSON);
  const metrics = computeGroupMetrics(buildFacts(oneDayRaw(), { observe }));
  const res = evaluate(metrics, t);
  // one_day: 3 baand, n=2 >= minStages 2: breakaway 0.5 (max 0.5) OK, favorit 0.5 OK, udgaaede 0.33 > 0.3 AFVIGELSE.
  assert.equal(res.ok, 2);
  assert.equal(res.deviations, 1);
  assert.deepEqual(res.deviating.map((d) => d.key), ["abandonShare"]);
  // gt har et baand men ingen data: for lidt data, aldrig afvigelse.
  assert.equal(res.tooLittle, 1);
  assert.equal(res.groups.gt.rows.find((r) => r.key === "gcWinnerFromBreakawayShare").status, "FOR_LIDT");
  assert.equal(res.groups.one_day.rows.find((r) => r.key === "crashShare").status, "INFO");
  assert.equal(summaryLine(res), "2 gates OK / 1 afvigelser, 1 uden nok data");
});

test("evaluate: stikproevegraensen kan overstyres pr. gruppe", () => {
  const t = parseThresholds(JSON.stringify({ weeklyEngineDrift: { minStages: 100, groups: { one_day: { minStages: 1, abandonShare: { max: 0.9 } } } } }));
  const res = evaluate(computeGroupMetrics(buildFacts(oneDayRaw(), { observe })), t);
  assert.equal(res.ok, 1);
});

test("summaryLine og logfilen indeholder aldrig maalte tal", async () => {
  const logs = [];
  const sent = [];
  const code = await main({
    env: { SUPABASE_URL: "u", SUPABASE_SERVICE_KEY: "k", ENGINE_GATE_THRESHOLDS_JSON: THRESHOLDS_JSON, DISCORD_OPS_WEBHOOK_URL: "https://hook.invalid/x", DISCORD_OPS_MENTION: "123" },
    makeDb: () => fakeDb(oneDayRaw()),
    loadModules: async () => fakeModules(),
    fetchFn: async (url, init) => { sent.push(JSON.parse(init.body)); return { ok: true }; },
    log: (s) => logs.push(s),
    errorLog: (s) => logs.push(s),
    now: NOW,
  });
  assert.equal(code, 1);
  assert.deepEqual(logs, ["weekly-engine-drift: 2 gates OK / 1 afvigelser, 1 uden nok data"]);
  assert.ok(sent.length >= 2);
  assert.equal(sent[0].content, "<@123>"); // alarmen foerst, med mention
  assert.match(sent[0].embeds[0].description, /afvigelser/);
  assert.ok(!sent[1].content);
  assert.match(sent[1].embeds[0].description, /Endagsloeb/);
});

// ── Rapport og Discord ───────────────────────────────────────────────────────

test("renderReport og alarmText navngiver afvigelsen", () => {
  const res = evaluate(computeGroupMetrics(buildFacts(oneDayRaw(), { observe })), parseThresholds(THRESHOLDS_JSON));
  const text = renderReport(res, { since: "2026-10-19T00:00:00Z", until: "2026-10-26T00:00:00Z" });
  assert.match(text, /2026-10-19 til 2026-10-26/);
  assert.match(text, /\*\*AFVIGELSE\*\* udgaaede i alt/);
  assert.match(text, /rev_a: 2/);
  assert.match(alarmText(res), /Endagsloeb: udgaaede i alt/);
});

test("splitReport klipper paa linjegraenser under graensen", () => {
  const text = Array.from({ length: 100 }, (_, i) => `linje ${i} ${"x".repeat(80)}`).join("\n");
  const parts = splitReport(text, 1000);
  assert.ok(parts.length > 1);
  assert.ok(parts.every((p) => p.length <= 1000));
  assert.equal(parts.join("\n"), text);
});

test("buildPayloads: ingen alarm uden afvigelse; ingen mention uden mention", () => {
  const res = evaluate(computeGroupMetrics(buildFacts(oneDayRaw(), { observe })), parseThresholds(JSON.stringify({ weeklyEngineDrift: { minStages: 1, groups: { one_day: { abandonShare: { max: 0.9 } } } } })));
  const payloads = buildPayloads(res, renderReport(res), { mention: null });
  assert.equal(payloads.length, 1);
  assert.equal(payloads[0].content, undefined);
  assert.equal(payloads[0].embeds[0].color, 0x2ecc71);
});

// ── Read-only og vindue ──────────────────────────────────────────────────────

test("makeReadOnlyClient kan kun select", () => {
  const calls = [];
  const client = { from: (t) => ({ select: (c) => { calls.push(["select", t, c]); return "q"; }, insert: () => { throw new Error("skrivning"); } }) };
  const ro = makeReadOnlyClient(client);
  assert.equal(ro.from("races").select("id"), "q");
  assert.equal(ro.from("races").insert, undefined);
  assert.equal(ro.from("races").update, undefined);
  assert.equal(ro.from("races").delete, undefined);
  assert.equal(ro.from("races").upsert, undefined);
  assert.equal(ro.rpc, undefined);
  assert.deepEqual(calls, [["select", "races", "id"]]);
});

test("windowOf", () => {
  const w = windowOf({ days: 7, now: new Date("2026-10-26T05:00:00Z") });
  assert.equal(w.until, "2026-10-26T05:00:00.000Z");
  assert.equal(w.since, "2026-10-19T05:00:00.000Z");
  assert.throws(() => windowOf({ days: 0, now: NOW }), /positivt/);
  assert.throws(() => windowOf({ until: "ikke en dato", now: NOW }), /gyldigt/);
});

test("fetchRaw: pagineret og kun select; tom uge giver tomt resultat", async () => {
  const db = fakeDb({ schedule: [], races: [], results: [], incidents: [], profiles: [] });
  const raw = await fetchRaw(db, { since: "a", until: "b" });
  assert.deepEqual(raw.races, []);
  const full = await fetchRaw(fakeDb(oneDayRaw()), { since: "2026-10-19T00:00:00Z", until: "2026-10-27T00:00:00Z", abilityKeys: ["tempo"] });
  assert.equal(full.results.length, oneDayRaw().results.length);
  assert.equal(full.incidents.length, oneDayRaw().incidents.filter((i) => i.outcome === "abandon").length);
});

// ── main: konfiguration og leveringsfejl ─────────────────────────────────────

test("main: manglende env og ugyldig taerskelfil giver exit 2 uden at sende", async () => {
  const errs = [];
  const sent = [];
  const args = { now: NOW, errorLog: (s) => errs.push(s), fetchFn: async () => { sent.push(1); return { ok: true }; }, log: () => {} };
  assert.equal(await main({ ...args, env: {} }), 2);
  assert.match(errs[0], /mangler env/);
  assert.deepEqual(missingEnv({ SUPABASE_URL: "x" }), ["SUPABASE_SERVICE_KEY", "ENGINE_GATE_THRESHOLDS_JSON", "DISCORD_OPS_WEBHOOK_URL"]);
  assert.equal(await main({ ...args, env: { SUPABASE_URL: "u", SUPABASE_SERVICE_KEY: "k", ENGINE_GATE_THRESHOLDS_JSON: "{}", DISCORD_OPS_WEBHOOK_URL: "https://hook.invalid/x" } }), 2);
  assert.equal(sent.length, 0);
});

test("main: datafejl giver exit 3 og logger ingen detaljer", async () => {
  const errs = [];
  const code = await main({
    env: { SUPABASE_URL: "u", SUPABASE_SERVICE_KEY: "k", ENGINE_GATE_THRESHOLDS_JSON: THRESHOLDS_JSON, DISCORD_OPS_WEBHOOK_URL: "https://hook.invalid/x" },
    makeDb: () => { throw new Error("hemmelig url https://x.supabase.co"); },
    loadModules: async () => fakeModules(),
    errorLog: (s) => errs.push(s), log: () => {}, now: NOW,
  });
  assert.equal(code, 3);
  assert.ok(!errs.join("\n").includes("supabase.co"));
});

test("main: Discord-fejl giver exit 3; alt groent giver exit 0; dry-run sender intet", async () => {
  const okEnv = { SUPABASE_URL: "u", SUPABASE_SERVICE_KEY: "k", ENGINE_GATE_THRESHOLDS_JSON: JSON.stringify({ weeklyEngineDrift: { minStages: 1, groups: { one_day: { abandonShare: { max: 0.9 } } } } }), DISCORD_OPS_WEBHOOK_URL: "https://hook.invalid/x" };
  const base = { now: NOW, makeDb: () => fakeDb(oneDayRaw()), loadModules: async () => fakeModules(), log: () => {}, errorLog: () => {} };
  assert.equal(await main({ ...base, env: okEnv, fetchFn: async () => ({ ok: false }) }), 3);
  assert.equal(await main({ ...base, env: okEnv, fetchFn: async () => ({ ok: true }) }), 0);
  let n = 0;
  const { DISCORD_OPS_WEBHOOK_URL: _hook, ...noHook } = okEnv;
  assert.equal(await main({ ...base, env: { ...noHook, WEEKLY_DRIFT_DRY_RUN: "1" }, fetchFn: async () => { n += 1; return { ok: true }; } }), 0);
  assert.equal(n, 0);
});

test("main: WEEKLY_DRIFT_OUT uden for balance-internals afvises", async () => {
  const code = await main({
    env: { SUPABASE_URL: "u", SUPABASE_SERVICE_KEY: "k", ENGINE_GATE_THRESHOLDS_JSON: THRESHOLDS_JSON, DISCORD_OPS_WEBHOOK_URL: "https://hook.invalid/x", WEEKLY_DRIFT_OUT: "rapport.md" },
    makeDb: () => fakeDb(oneDayRaw()), loadModules: async () => fakeModules(), fetchFn: async () => ({ ok: true }), log: () => {}, errorLog: () => {}, now: NOW,
  });
  assert.equal(code, 2);
});

test("GROUPS daekker alle fire krævede gruppe-typer", () => {
  for (const g of ["short_stage_race", "gt", "one_day", "monument", "u23_junior"]) assert.ok(GROUPS.includes(g));
});

// ── Falsk Supabase ───────────────────────────────────────────────────────────

function fakeModules() {
  return {
    abilityKeys: ["tempo"],
    observeStageV4: observe,
    tuning: {},
    entrantFromAbilitiesRow: (rowArg) => rowArg,
  };
}

/** Minimal PostgREST-lignende klient: kun select, med in/eq/gte/lt/gt/order/range/limit. */
function fakeDb(data) {
  const tables = {
    race_stage_schedule: data.schedule ?? [],
    races: data.races ?? [],
    race_results: data.results ?? [],
    race_incidents: data.incidents ?? [],
    race_stage_profiles: data.profiles ?? [],
    rider_derived_abilities: data.abilities ?? [],
  };
  return makeReadOnlyClient({
    from(table) {
      const filters = [];
      let orderKeys = [];
      let rangeFrom = 0;
      let rangeTo = Infinity;
      const q = {
        select() { return q; },
        in(col, vals) { filters.push((r) => vals.includes(r[col])); return q; },
        eq(col, v) { filters.push((r) => r[col] === v); return q; },
        gte(col, v) { filters.push((r) => r[col] >= v); return q; },
        lt(col, v) { filters.push((r) => r[col] < v); return q; },
        gt(col, v) { filters.push((r) => r[col] > v); return q; },
        order(col) { orderKeys.push(col); return q; },
        range(a, b) { rangeFrom = a; rangeTo = b; return q; },
        limit(n) { rangeFrom = 0; rangeTo = n - 1; return q; },
        then(resolve) {
          let rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
          for (const k of [...orderKeys].reverse()) rows = [...rows].sort((a, b) => (a[k] > b[k] ? 1 : a[k] < b[k] ? -1 : 0));
          resolve({ data: rows.slice(rangeFrom, rangeTo + 1), error: null });
        },
      };
      return q;
    },
  });
}
