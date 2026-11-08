import { test } from "node:test";
import assert from "node:assert/strict";
import { ownDayFormEvents, withOwnDayFormOnly } from "./dayFormVisibility7725.js";
import { buildRaceStory } from "./raceStory.js";

const ev = (km, type, params = {}) => ({ km, type, params });

const EVENTS = Object.freeze([
  ev(0, "stage_start", { distance_km: 180 }),
  ev(90, "incident", { rider_id: "rival", kind: "crash", outcome: "time_loss" }),
  ev(180, "bad_day", { rider_id: "rival", reason: "illness" }),
  ev(180, "bad_day", { rider_id: "mine-a", reason: "form" }),
  ev(180, "day_word", { rider_id: "rival", word: "great" }),
  ev(180, "day_word", { rider_id: "mine-a", word: "bad", reason: "form" }),
  ev(180, "day_word", { rider_id: "mine-dnf", word: "good" }),
  ev(180, "day_word", { word: "good" }),
  ev(180, "finish", { top: [{ rider_id: "rival" }] }),
]);

/** Mindste supabase-kaede: hver tabel svarer med sine raekker, filtre noteres. */
function fakeSupabase(tables) {
  const calls = [];
  return {
    calls,
    from(table) {
      const call = { table, filters: {} };
      calls.push(call);
      const chain = {
        select: () => chain,
        eq: (column, value) => { call.filters[column] = value; return chain; },
        then: (resolve) => resolve(tables[table] ?? { data: [], error: null }),
      };
      return chain;
    },
  };
}

const OWNED = { race_entries: { data: [{ rider_id: "mine-a" }, { rider_id: "mine-dnf" }], error: null }, race_results: { data: [{ rider_id: "mine-a" }, { rider_id: null }], error: null } };
const INPUT = { events: EVENTS, raceId: "race-1", stageNumber: 3, teamId: "team-me" };
const dayForm = (events) => events.filter((e) => e.type === "day_word" || e.type === "bad_day");

test("#7725: andres ryttere findes ikke i svaret, dine egne er med, ogsaa en der ikke kom i maal", async () => {
  const out = await ownDayFormEvents(fakeSupabase(OWNED), INPUT);
  assert.deepEqual(dayForm(out).map((e) => [e.type, e.params.rider_id]), [["bad_day", "mine-a"], ["day_word", "mine-a"], ["day_word", "mine-dnf"]]);
  assert.ok(!JSON.stringify(dayForm(out)).includes("rival"), "vinderen paa et andet hold er ikke med");
});

test("#7725: alt andet i tidslinjen er uroert, og den gemte liste muteres ikke", async () => {
  const before = JSON.stringify(EVENTS);
  const out = await ownDayFormEvents(fakeSupabase(OWNED), INPUT);
  assert.deepEqual(out.filter((e) => e.type !== "day_word" && e.type !== "bad_day"), EVENTS.filter((e) => e.type !== "day_word" && e.type !== "bad_day"));
  assert.equal(JSON.stringify(EVENTS), before);
});

test("#7725: opslaget er afgraenset til dette loeb, denne etape og seerens hold", async () => {
  const supabase = fakeSupabase(OWNED);
  await ownDayFormEvents(supabase, INPUT);
  assert.deepEqual(supabase.calls.map((c) => [c.table, c.filters]), [
    ["race_entries", { race_id: "race-1", team_id: "team-me" }],
    ["race_results", { race_id: "race-1", team_id: "team-me", stage_number: 3, result_type: "stage" }],
  ]);
});

test("#7725: uden hold faar seeren ingen dagsform og der slaas intet op", async () => {
  for (const teamId of [null, undefined]) {
    const supabase = fakeSupabase(OWNED);
    const out = await ownDayFormEvents(supabase, { ...INPUT, teamId });
    assert.deepEqual(dayForm(out), []);
    assert.equal(supabase.calls.length, 0);
  }
});

test("#7725: en etape uden dagsform koster intet opslag og kommer uaendret tilbage", async () => {
  const supabase = fakeSupabase(OWNED);
  const plain = [ev(0, "stage_start"), ev(180, "finish")];
  assert.equal(await ownDayFormEvents(supabase, { ...INPUT, events: plain }), plain);
  assert.equal(supabase.calls.length, 0);
});

test("#7725: fejler opslaget, sendes ingen dagsform, men resten af tidslinjen gaar igennem", async () => {
  const out = await ownDayFormEvents(fakeSupabase({ ...OWNED, race_results: { data: null, error: { message: "boom" } } }), INPUT);
  assert.deepEqual(dayForm(out), []);
  assert.equal(out.length, EVENTS.length - dayForm(EVENTS).length);
});

test("#7725: en haendelse uden rytter og ikke-liste-input slipper ikke igennem som dagsform", () => {
  assert.deepEqual(withOwnDayFormOnly([ev(1, "day_word", { word: "good" })], new Set(["a"])), []);
  assert.equal(withOwnDayFormOnly(null, new Set()), null);
});

test("#7725: historien bygget af det filtrerede svar naevner ikke andres daarlige dag (film og referat)", async () => {
  const events = await ownDayFormEvents(fakeSupabase(OWNED), INPUT);
  const story = buildRaceStory({ events, timelineVersion: 2 });
  const badDays = story.moments.filter((m) => m.type === "bad_day");
  assert.ok(badDays.length > 0, "din egen daarlige dag er stadig i historien");
  assert.ok(!JSON.stringify(badDays).includes("rival"));
});

test("#7916: Hvorfor? paa en enkeltstart laeser samme haendelser, saa den faar kun dine egne ord", async () => {
  const timeTrial = [
    ev(0, "stage_start", { distance_km: 30 }),
    ev(30, "day_word", { rider_id: "rival", word: "bad", reason: "fatigue" }),
    ev(30, "day_word", { rider_id: "mine-a", word: "great" }),
    ev(30, "finish", {}),
  ];
  const out = await ownDayFormEvents(fakeSupabase(OWNED), { ...INPUT, events: timeTrial });
  const wordFor = (id) => out.find((e) => e.type === "day_word" && e.params.rider_id === id)?.params.word;
  assert.equal(wordFor("mine-a"), "great");
  assert.equal(wordFor("rival"), undefined, "andres rytter har intet ord at forklare med");
});
