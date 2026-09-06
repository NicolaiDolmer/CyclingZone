import test from "node:test";
import assert from "node:assert/strict";

import {
  findStrandedRiderIds,
  runRiderDeriveHealSweep,
  HEAL_BATCH_LIMIT,
} from "./riderDeriveHealSweep.js";

// Mock der dækker sweep'ens to læse-queries:
//   riders:                  select("id, base_value").eq("is_retired", false).order().range()
//   rider_derived_abilities: select("rider_id").order().range()
function makeMock({ riders = [], derived = [] }) {
  function from(table) {
    let isRetiredFilter = null;
    const b = {
      select() { return b; },
      eq(col, val) { if (col === "is_retired") isRetiredFilter = val; return b; },
      order() { return b; },
      range() {
        if (table === "riders") {
          const rows = riders
            .filter((r) => (isRetiredFilter == null ? true : r.is_retired === isRetiredFilter))
            .map((r) => ({ id: r.id, base_value: r.base_value }));
          return Promise.resolve({ data: rows, error: null });
        }
        if (table === "rider_derived_abilities") {
          return Promise.resolve({ data: derived.map((d) => ({ rider_id: d })), error: null });
        }
        return Promise.resolve({ data: [], error: null });
      },
    };
    return b;
  }
  return { from };
}

test("findStrandedRiderIds: fanger manglende derived-række OG base_value NULL, springer retired + sunde over", async () => {
  const supabase = makeMock({
    riders: [
      { id: "ok", base_value: 100, is_retired: false },          // sund
      { id: "no-derived", base_value: 100, is_retired: false },  // mangler derived-række
      { id: "null-value", base_value: null, is_retired: false }, // base_value NULL
      { id: "retired", base_value: null, is_retired: true },     // retired → ignoreres af .eq-filteret
    ],
    derived: ["ok", "null-value"], // "no-derived" har ingen ability-række
  });

  const { strandedIds, activeCount } = await findStrandedRiderIds(supabase);
  assert.deepEqual(strandedIds.sort(), ["no-derived", "null-value"]);
  assert.equal(activeCount, 3, "retired rytter tælles ikke som aktiv");
});

test("findStrandedRiderIds: alt sundt → tomt strandet-sæt", async () => {
  const supabase = makeMock({
    riders: [{ id: "a", base_value: 50, is_retired: false }, { id: "b", base_value: 60, is_retired: false }],
    derived: ["a", "b"],
  });
  const { strandedIds } = await findStrandedRiderIds(supabase);
  assert.deepEqual(strandedIds, []);
});

test("runRiderDeriveHealSweep: re-deriver strandede ryttere via injiceret derive", async () => {
  const supabase = makeMock({
    riders: [
      { id: "ok", base_value: 100, is_retired: false },
      { id: "stranded", base_value: null, is_retired: false },
    ],
    derived: ["ok"],
  });
  const calls = [];
  const deriveForRiderIds = async (_sb, ids) => { calls.push(ids); return { riders: ids.length }; };

  const res = await runRiderDeriveHealSweep({ supabase, deriveForRiderIds });
  assert.deepEqual(calls, [["stranded"]], "kun den strandede rytter re-derives");
  assert.equal(res.stranded, 1);
  assert.equal(res.healed, 1);
});

test("runRiderDeriveHealSweep: ingen strandede → no-op (derive aldrig kaldt)", async () => {
  const supabase = makeMock({
    riders: [{ id: "a", base_value: 50, is_retired: false }],
    derived: ["a"],
  });
  let called = false;
  const deriveForRiderIds = async () => { called = true; return { riders: 0 }; };

  const res = await runRiderDeriveHealSweep({ supabase, deriveForRiderIds });
  assert.equal(res.stranded, 0);
  assert.equal(res.healed, 0);
  assert.equal(called, false, "derive må ikke kaldes når intet er strandet");
});

test("runRiderDeriveHealSweep: cap'er antal pr. tick til limit, rapporterer remaining", async () => {
  const riders = [];
  for (let i = 0; i < 5; i++) riders.push({ id: `s${i}`, base_value: null, is_retired: false });
  const supabase = makeMock({ riders, derived: [] });
  const calls = [];
  const deriveForRiderIds = async (_sb, ids) => { calls.push(ids); return { riders: ids.length }; };

  const res = await runRiderDeriveHealSweep({ supabase, deriveForRiderIds, limit: 2 });
  assert.equal(calls[0].length, 2, "kun limit-mange heales pr. tick");
  assert.equal(res.stranded, 5);
  assert.equal(res.remaining, 3, "resten tages næste tick");
});

test("HEAL_BATCH_LIMIT er en fornuftig positiv cap", () => {
  assert.ok(Number.isFinite(HEAL_BATCH_LIMIT) && HEAL_BATCH_LIMIT > 0);
});

test("runRiderDeriveHealSweep: kræver en supabase-klient", async () => {
  await assert.rejects(() => runRiderDeriveHealSweep({}), /Supabase client required/);
});

// ─── CYCLINGZONE-51: uvurderbare ryttere er en TILSTAND, ikke en sweep-fejl ────

test("runRiderDeriveHealSweep: rapporterer uvurderbare ryttere videre uden at kaste", async () => {
  // Rytteren har ability-række men ingen base_value fordi modellen ikke kan
  // værdisætte ham (i prod: sæson-alder over NPV-motorens horisont). Sweep'en skal
  // fuldføre og rapportere ham, så cron'en kan alarmere ÉN gang på tilstanden i
  // stedet for at fælde hele sweep'en hvert 5. minut.
  const supabase = makeMock({
    riders: [{ id: "gammel", base_value: null, is_retired: false }],
    derived: ["gammel"],
  });
  const deriveForRiderIds = async (_sb, ids) => ({ riders: ids.length, unvaluable: ids });

  const res = await runRiderDeriveHealSweep({ supabase, deriveForRiderIds });
  assert.equal(res.stranded, 1);
  assert.deepEqual(res.unvaluable, ["gammel"]);
});

test("runRiderDeriveHealSweep: unvaluable er en tom liste når derive ikke rapporterer nogen", async () => {
  const supabase = makeMock({
    riders: [{ id: "s1", base_value: null, is_retired: false }],
    derived: [],
  });
  const deriveForRiderIds = async (_sb, ids) => ({ riders: ids.length });

  const res = await runRiderDeriveHealSweep({ supabase, deriveForRiderIds });
  assert.deepEqual(res.unvaluable, [], "manglende felt må ikke lække undefined til dedupe-signaturen");
});
