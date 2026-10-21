// #6804 P0: menneskeholdenes udbrudsvilje i testportens syntetiske felt. Kun syntetiske fixtures.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MIN_CELL_TEAM_STAGES, RATES_FORMAT, aggregateIntentRates, applyBreakawayIntent, breakawayAbilityFor,
  draws, raceGroupOf, ratesFor, ratesSignature, validateRates,
} from "./breakawayIntent.mjs";

const rates = (rows, extra = {}) => ({ format: RATES_FORMAT, seasonId: "s", minCellTeamStages: MIN_CELL_TEAM_STAGES, rows, ...extra });
const cell = (division, group, o) => ({ division, group, humanTeamRaces: 10, humanTeamStages: 100, hunters: 0, freeRoles: 0, tryBreakRiders: 0, ...o });

/** Et loeb med to menneskehold (h1, h2) og et AI-hold (a1), hver med kaptajn, sprint-kaptajn og tre hjaelpere. */
function race({ stages = 3, profiles = null, orders = [] } = {}) {
  const teams = [{ id: "h1", is_ai: false }, { id: "h2", is_ai: false }, { id: "a1", is_ai: true }];
  const entries = [];
  const abilities = [];
  for (const t of teams) {
    entries.push({ rider_id: `${t.id}-cap`, team_id: t.id, race_role: "captain" });
    entries.push({ rider_id: `${t.id}-spr`, team_id: t.id, race_role: "sprint_captain" });
    abilities.push({ rider_id: `${t.id}-cap`, aggression: 99, endurance: 99, climbing: 99, tempo: 99 });
    abilities.push({ rider_id: `${t.id}-spr`, aggression: 99, endurance: 99, climbing: 99, tempo: 99 });
    for (const [n, agg, climb] of [[1, 80, 40], [2, 60, 90], [3, 30, 30]]) {
      entries.push({ rider_id: `${t.id}-h${n}`, team_id: t.id, race_role: "helper" });
      abilities.push({ rider_id: `${t.id}-h${n}`, aggression: agg, endurance: 50, climbing: climb, tempo: 50 });
    }
  }
  const ps = profiles ?? Array.from({ length: stages }, (_, i) => ({ stage_number: i + 1, profile_type: i === 0 ? "itt" : "mountain", finale_type: "long_climb" }));
  return { race: { id: "r1", stages: ps.length, league_division_id: 1 }, profiles: ps, entries, orders, teams, abilities };
}

test("#6804 P0 raceGroupOf: endagsloeb, etapeloeb og Grand Tour", () => {
  assert.deepEqual([1, 2, 8, 14, 15, 21].map(raceGroupOf), ["one_day", "stage_race", "stage_race", "stage_race", "gt", "gt"]);
});

test("#6804 P0 breakawayAbilityFor spejler M14's udbruds-evne pr. terraen", () => {
  assert.equal(breakawayAbilityFor({ profile_type: "hilly", finale_type: "punch" }), "punch");
  assert.equal(breakawayAbilityFor({ profile_type: "flat", finale_type: "flat_sprint" }), "tempo");
  assert.equal(breakawayAbilityFor({ profile_type: "mountain", finale_type: "descent" }), "climbing");
  assert.equal(breakawayAbilityFor({ profile_type: "cobbles" }), "cobblestone");
});

test("#6804 P0 draws: deterministisk, og gennemsnittet rammer satsen", () => {
  assert.equal(draws(1.5, "k"), draws(1.5, "k"));
  assert.equal(draws(0, "k"), 0);
  assert.ok(draws(2, "k") === 2);
  let sum = 0;
  for (let i = 0; i < 4000; i++) sum += draws(0.3, `k${i}`);
  assert.ok(Math.abs(sum / 4000 - 0.3) < 0.03, `middel ${sum / 4000}`);
});

test("#6804 P0 aggregateIntentRates: kun menneskehold taeller, pr. division og gruppe + samlet", () => {
  const races = [{ id: "g", league_division_id: 1, stages: 21 }, { id: "d", league_division_id: 2, stages: 1 }];
  const teams = [{ id: "h", is_ai: false }, { id: "a", is_ai: true }];
  const entries = [
    { race_id: "g", team_id: "h", race_role: "hunter" }, { race_id: "g", team_id: "h", race_role: "helper" },
    { race_id: "g", team_id: "a", race_role: "hunter" },
    { race_id: "d", team_id: "h", race_role: "free_role" },
  ];
  const orders = [
    { race_id: "g", team_id: "h", stage_number: 2, riders: [{ rider_id: "x", try_break: true }, { rider_id: "y", try_break: false }] },
    { race_id: "g", team_id: "a", stage_number: 2, riders: [{ rider_id: "z", try_break: true }] },
    { race_id: "g", team_id: "h", stage_number: 3, riders: "korrupt" },
  ];
  const out = aggregateIntentRates({ races, entries, teams, orders, seasonId: "s5" });
  assert.equal(out.format, RATES_FORMAT);
  const gt1 = out.rows.find((r) => r.division === "1" && r.group === "gt");
  assert.deepEqual(gt1, { division: "1", group: "gt", humanTeamRaces: 1, humanTeamStages: 21, hunters: 1, freeRoles: 0, tryBreakRiders: 1 });
  const dayAll = out.rows.find((r) => r.division === "all" && r.group === "one_day");
  assert.deepEqual([dayAll.humanTeamRaces, dayAll.freeRoles], [1, 1]);
});

test("#6804 P0 ratesFor: lille celle falder tilbage til gruppens samlede sats", () => {
  const r = rates([
    cell("1", "gt", { humanTeamStages: MIN_CELL_TEAM_STAGES - 1, hunters: 50 }),
    cell("all", "gt", { hunters: 5, tryBreakRiders: 50 }),
    cell("3", "stage_race", { hunters: 2 }),
  ]);
  const gt = ratesFor(r, 1, 21);
  assert.equal(gt.source, "alle divisioner");
  assert.equal(gt.hunterPerRace, 0.5);
  assert.equal(gt.tryBreakPerStage, 0.5);
  assert.equal(ratesFor(r, 3, 5).source, "division 3");
  assert.equal(ratesFor(r, 3, 1).source, "none", "ingen celle for endagsloeb");
});

test("#6804 P0 applyBreakawayIntent: kun menneskeholdenes hjaelpere, aldrig kaptajner eller AI-hold", () => {
  const r = rates([cell("all", "stage_race", { hunters: 10, freeRoles: 10, tryBreakRiders: 100 })]);
  const data = race();
  const { data: out, summary } = applyBreakawayIntent(data, r);
  const role = (id) => out.entries.find((e) => e.rider_id === id).race_role;
  for (const t of ["h1", "h2"]) {
    assert.equal(role(`${t}-h1`), "hunter", "hoejest aggression + udholdenhed");
    assert.equal(role(`${t}-h2`), "free_role");
    assert.equal(role(`${t}-cap`), "captain");
    assert.equal(role(`${t}-spr`), "sprint_captain");
  }
  assert.ok(out.entries.filter((e) => e.team_id === "a1").every((e) => ["captain", "sprint_captain", "helper"].includes(e.race_role)), "AI-hold uroert");
  assert.deepEqual([summary.hunters, summary.freeRoles, summary.humanTeams], [2, 2, 2]);
  // Ordrer: kun vejetaper, kun menneskehold, kun de tilbageblevne hjaelpere.
  assert.ok(out.orders.every((o) => o.stage_number !== 1), "ingen ordre paa enkeltstarten");
  assert.ok(out.orders.every((o) => o.team_id !== "a1"));
  assert.ok(out.orders.every((o) => o.riders.every((x) => x.try_break === true && /-h3$/.test(x.rider_id))));
  assert.equal(data.entries.find((e) => e.rider_id === "h1-h1").race_role, "helper", "input muteres ikke");
});

test("#6804 P0 applyBreakawayIntent: dagens terraen vaelger rytteren, og en eksisterende ordre vinder", () => {
  const r = rates([cell("all", "stage_race", { tryBreakRiders: 100 })]);
  const profiles = [{ stage_number: 1, profile_type: "mountain", finale_type: "long_climb" }, { stage_number: 2, profile_type: "flat", finale_type: "flat_sprint" }];
  const existing = { team_id: "h2", race_id: "r1", stage_number: 1, breakaway_stance: "chase", riders: [] };
  const { data: out } = applyBreakawayIntent(race({ profiles, orders: [existing] }), r);
  const pick = (team, stage) => out.orders.find((o) => o.team_id === team && o.stage_number === stage)?.riders.map((x) => x.rider_id);
  assert.deepEqual(pick("h1", 1), ["h1-h2"], "bjerg: aggression + klatring");
  assert.deepEqual(pick("h1", 2), ["h1-h1"], "flad: aggression + tempo");
  assert.equal(out.orders.filter((o) => o.team_id === "h2" && o.stage_number === 1).length, 1, "holdets egen raekke roeres ikke");
  assert.equal(out.orders.find((o) => o.team_id === "h2" && o.stage_number === 1).breakaway_stance, "chase");
});

test("#6804 P0 applyBreakawayIntent: samme input giver samme felt; nul-satser roerer intet", () => {
  const r = rates([cell("all", "gt", { hunters: 4, tryBreakRiders: 60 })]);
  const data = race({ profiles: Array.from({ length: 21 }, (_, i) => ({ stage_number: i + 1, profile_type: "hilly", finale_type: "punch" })) });
  assert.deepEqual(applyBreakawayIntent(data, r), applyBreakawayIntent(data, r));
  const none = applyBreakawayIntent(data, rates([]));
  assert.deepEqual(none.data.entries, data.entries);
  assert.deepEqual(none.data.orders, []);
});

test("#6804 P0 validateRates + ratesSignature", () => {
  assert.throws(() => validateRates({ format: "x", rows: [] }), /format/);
  const a = rates([cell("all", "gt")]);
  assert.equal(validateRates(a), a);
  assert.notEqual(ratesSignature(a), ratesSignature(rates([cell("all", "gt", { hunters: 1 })])));
  assert.equal(ratesSignature(a), ratesSignature({ ...a, generatedAt: "andet tidspunkt" }), "kun raekkerne taeller");
});
