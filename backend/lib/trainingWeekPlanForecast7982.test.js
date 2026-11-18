// #7982 skaermdelen: prognosen siger, hvilke af dagens felter der er koert (kvittering), saa
// traeningsgitteret kan skrive "Koert" og laase netop dem. Kun med training_settle_race_session
// on; slukket er svaret uaendret (felterne findes ikke). Det frosne bevis for slukket ligger i
// trainingWeekPlanForecastGolden7801.test.js (facit fra merge-base, roeres ikke).
import assert from "node:assert/strict";
import test from "node:test";

import { buildTeamFatigueForecast, loadTeamFatigueForecast } from "./trainingWeekPlanForecast.js";
import { SEASON, createFake, world } from "./dommer7801RestByg.harness.mjs";

const TICK_DATE = "2026-10-01";
const DAYS = [41, 42, 43, 44, 45];

function base(overrides = {}) {
  return {
    tickDate: TICK_DATE, seasonId: "s4", dateGameDays: DAYS,
    riders: [{ id: "r1", primary_type: "sprinter" }, { id: "r2", primary_type: "climber" }],
    conditionByRider: new Map([["r1", { fatigue: 55, form: 50 }], ["r2", { fatigue: 40, form: 50 }]]),
    recordedLoads: [{ rider_id: "r1", game_day: 43, load: 10, duplicate_of_race_id: null }],
    receipts: [{ rider_id: "r1", game_day: 43, tick_date: TICK_DATE, report: { race_session_7982: true } }],
    ...overrides,
  };
}

test("ren kerne: slukket giver ingen ranSlots, og resten af svaret er det samme", () => {
  const off = buildTeamFatigueForecast(base());
  const on = buildTeamFatigueForecast(base({ ranSlots: true }));
  assert.equal("ranSlots" in off.r1, false);
  assert.equal("ranSlots" in off.r2, false);
  for (const id of ["r1", "r2"]) {
    const { ranSlots: _ignored, ...rest } = on[id];
    assert.deepEqual(rest, off[id]);
  }
});

test("ren kerne: loebets session med kvittering er koert; de andre felter er ikke", () => {
  const on = buildTeamFatigueForecast(base({ ranSlots: true }));
  assert.deepEqual(on.r1.ranSlots, [2]);
  assert.deepEqual(on.r1.raceSlots, [2]);
  assert.deepEqual(on.r2.ranSlots, []);
});

test("ren kerne: to etaper samme dato, kun den afgjorte er koert", () => {
  const on = buildTeamFatigueForecast(base({
    ranSlots: true,
    recordedLoads: [{ rider_id: "r1", game_day: 42, load: 10, duplicate_of_race_id: null }],
    plannedStages: [{ rider_id: "r1", game_day: 45, profile_type: "flat" }],
    receipts: [{ rider_id: "r1", game_day: 42, tick_date: TICK_DATE, report: { race_session_7982: true } }],
  }));
  assert.deepEqual(on.r1.raceSlots, [1, 4]);
  assert.deepEqual(on.r1.ranSlots, [1]);
});

async function forecastFor(name, team, settleValue) {
  const { now, state } = world(name, "on");
  if (settleValue !== undefined) state.app_config.push({ key: "training_settle_race_session", value: settleValue });
  const fake = createFake(state);
  const saved = { warn: console.warn, error: console.error };
  console.warn = () => {}; console.error = () => {};
  try {
    return { svar: await loadTeamFatigueForecast({ supabase: fake, team: { id: team, league_division_id: "div-1" }, seasonId: SEASON, now }), log: fake.log };
  } finally { Object.assign(console, saved); }
}

const hasRan = (svar) => Object.values(svar.riders ?? {}).some((entry) => "ranSlots" in entry);

test("I/O: kontakten on og en kvittering paa en aaben dato giver raceSessionSettle og ranSlots", async () => {
  const { svar } = await forecastFor("traen_nu_trykket", "team-a", "on");
  assert.equal(svar.settled, false);
  assert.ok(svar.raceSessionSettle, "skaermen faar at vide, at kontakten er on");
  assert.equal(typeof svar.raceSessionSettle.fatigueNow, "boolean");
  assert.ok(hasRan(svar));
  assert.ok(Object.values(svar.riders).some((entry) => entry.ranSlots.length > 0), "mindst et felt er koert");
});

for (const value of [undefined, "off", "beta", true]) {
  test(`I/O: kontakten ${JSON.stringify(value)} (ikke "on") giver svaret uden de nye felter`, async () => {
    const { svar } = await forecastFor("traen_nu_trykket", "team-a", value);
    assert.equal("raceSessionSettle" in svar, false);
    assert.equal(hasRan(svar), false);
  });
}

test("I/O: en dato uden kvitteringer laeser ikke kontakten (en almindelig dag er uaendret)", async () => {
  const { svar, log } = await forecastFor("midt_paa_dagen", "team-b", "on");
  assert.equal("raceSessionSettle" in svar, false);
  assert.equal(log.some((entry) => String(entry.target ?? "").includes("training_settle_race_session")), false);
});

test("I/O: kontakten aendrer intet svar paa en dato uden kvitteringer (alle dommerens verdener)", async () => {
  const scenarios = ["midt_paa_dagen", "morgen_foer_etaper", "aften_alle_koert", "hviledag", "model_v2_slukket", "laege_byttet"];
  for (const name of scenarios) {
    for (const team of ["team-a", "team-b"]) {
      const on = await forecastFor(name, team, "on");
      const off = await forecastFor(name, team, undefined);
      assert.deepEqual(on.svar, off.svar, `${name} / ${team}`);
      assert.equal(on.log.length, off.log.length, `${name} / ${team}: samme antal opslag`);
    }
  }
});

test("I/O: med kvitteringer laeses kontakten i samme runde som etapeopslagene (ingen ekstra ventetid)", async () => {
  const { log } = await forecastFor("traen_nu_trykket", "team-a", "on");
  const reads = log.filter((entry) => entry.target === "app_config:training_settle_race_session");
  assert.equal(reads.length, 1, "kontakten laeses praecis een gang");
  const otherRounds = new Set(log.filter((entry) => !reads.includes(entry)).map((entry) => entry.round));
  assert.ok(otherRounds.has(reads[0].round), "opslaget deler runde med andre opslag");
});
