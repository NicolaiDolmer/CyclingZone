// #8522 (#6110 G3a): talfilens procent-aldring og rytterens varige slid.
// Tallene er syntetiske (de rigtige står kun i den private talfil, hard rule 17).
import test from "node:test";
import assert from "node:assert/strict";

import {
  validateXpAgingPercent, isXpAgingPercentShape, agingRateAt, AGING_PLATEAU_THROUGH_AGE,
  sanitizeWear, addWear, wearForAbility, targetAfterWear, loadRiderWear, RIDER_WEAR_ID_CHUNK,
} from "./riderWear6110.js";

const G3A_TEST_AGING = Object.freeze({
  physical: [{ at: 30, value: 0 }, { at: 34, value: 0.04 }, { at: 40, value: 0.1 }],
  mental: [{ at: 32, value: 0 }, { at: 36, value: 0.01 }, { at: 40, value: 0.04 }],
});

test("procent-formen genkendes kun ved kurve-nøglerne, ikke ved kandidat B's trin-form", () => {
  assert.equal(isXpAgingPercentShape(G3A_TEST_AGING), true);
  assert.equal(isXpAgingPercentShape({ plateauThroughAge: 27, declineByYearsPastPlateau: [] }), false);
  assert.equal(isXpAgingPercentShape(null), false);
  assert.equal(isXpAgingPercentShape([]), false);
});

test("gyldig talfil giver en frossen kopi; udeladt = undefined", () => {
  const v = validateXpAgingPercent(G3A_TEST_AGING);
  assert.ok(v);
  assert.ok(Object.isFrozen(v) && Object.isFrozen(v.physical) && Object.isFrozen(v.physical[0]));
  assert.deepEqual(JSON.parse(JSON.stringify(v)), JSON.parse(JSON.stringify(G3A_TEST_AGING)));
  assert.equal(validateXpAgingPercent(undefined), undefined);
});

test("ugyldige talfiler afvises hele (null), så skiftet aldrig ælder efter en halv model", () => {
  const bad = {
    "ukendt nøgle": { ...G3A_TEST_AGING, late: {} },
    "stavefejl i punkt": { ...G3A_TEST_AGING, physical: [{ at: 30, value: 0 }, { at: 34, vaule: 0.04 }] },
    "mangler mental": { physical: G3A_TEST_AGING.physical },
    "kun ét punkt": { ...G3A_TEST_AGING, physical: [{ at: 30, value: 0 }] },
    "starter over nul": { ...G3A_TEST_AGING, physical: [{ at: 31, value: 0.01 }, { at: 40, value: 0.1 }] },
    "tager i plateauet": { ...G3A_TEST_AGING, physical: [{ at: 26, value: 0 }, { at: 34, value: 0.04 }] },
    "satsen falder med alderen": { ...G3A_TEST_AGING, physical: [{ at: 30, value: 0 }, { at: 34, value: 0.05 }, { at: 40, value: 0.03 }] },
    "alder ikke stigende": { ...G3A_TEST_AGING, physical: [{ at: 30, value: 0 }, { at: 30, value: 0.05 }] },
    "sats over skinnen": { ...G3A_TEST_AGING, physical: [{ at: 30, value: 0 }, { at: 40, value: 0.9 }] },
    "negativ sats": { ...G3A_TEST_AGING, mental: [{ at: 32, value: 0 }, { at: 36, value: -0.01 }] },
    "alder uden for karrieren": { ...G3A_TEST_AGING, physical: [{ at: 30, value: 0 }, { at: 70, value: 0.1 }] },
    "intet fald": { physical: [{ at: 30, value: 0 }, { at: 40, value: 0 }], mental: [{ at: 30, value: 0 }, { at: 40, value: 0 }] },
    "mental over fysisk": { ...G3A_TEST_AGING, mental: [{ at: 30, value: 0 }, { at: 34, value: 0.05 }, { at: 40, value: 0.06 }] },
    "ikke et objekt": "physical",
    "array": [G3A_TEST_AGING],
    "tal som tekst": { ...G3A_TEST_AGING, physical: [{ at: "30", value: 0 }, { at: 40, value: 0.1 }] },
  };
  for (const [name, raw] of Object.entries(bad)) assert.equal(validateXpAgingPercent(raw), null, name);
});

test("satsen glider med alderen: nul til og med plateauet, så jævnt stigende uden hårde trin", () => {
  const v = validateXpAgingPercent(G3A_TEST_AGING);
  for (let age = 18; age <= AGING_PLATEAU_THROUGH_AGE; age++) assert.equal(agingRateAt(v.physical, age), 0, `alder ${age}`);
  let prev = 0;
  let prevStep = null;
  for (let age = AGING_PLATEAU_THROUGH_AGE + 1; age <= 45; age++) {
    const r = agingRateAt(v.physical, age);
    assert.ok(r >= prev, `alder ${age}: aldrig mindre end året før`);
    const step = r - prev;
    // Intet spring: et års ændring er højst kurvens stejleste stykke, aldrig et trin.
    if (prevStep !== null) assert.ok(step <= 0.0101 + 1e-12, `alder ${age}: glidende`);
    prevStep = step;
    prev = r;
  }
  assert.ok(agingRateAt(v.mental, 35) < agingRateAt(v.physical, 35), "teknik og mental taber mindre");
  assert.equal(agingRateAt(v.mental, 32), 0, "og senere");
  assert.ok(agingRateAt(v.physical, 32) > 0);
  assert.equal(agingRateAt(v.physical, 37), 0.07, "lineært mellem punkterne");
  assert.equal(agingRateAt(v.physical, 60), 0.1, "fladt efter sidste punkt");
});

test("slid: kun synlige evner med positive hele point", () => {
  assert.deepEqual(sanitizeWear({ sprint: 2.4, climbing: -1, hidden_potential: 5, foo: 3, tempo: 0, flat: "3" }), { sprint: 2, flat: 3 });
  assert.deepEqual(sanitizeWear(null), {});
  assert.deepEqual(sanitizeWear([1, 2]), {});
});

test("slid bevares og vokser: en sæsons fald lægges til, intet trækkes fra", () => {
  const s1 = addWear(null, { sprint: 2, acceleration: 1, climbing: 0 });
  assert.deepEqual(s1, { sprint: 2, acceleration: 1 });
  const s2 = addWear(s1, { sprint: 1, tactics: 1, endurance: -3 });
  assert.deepEqual(s2, { sprint: 3, acceleration: 1, tactics: 1 });
  assert.deepEqual(s1, { sprint: 2, acceleration: 1 }, "det gamle objekt er urørt");
  assert.ok(Object.isFrozen(s2));
  assert.deepEqual(addWear(s2, {}), s2, "intet fald = samme slid");
});

test("målet sænkes med sliddet, aldrig under 0; evner uden slid er urørte", () => {
  const wear = { sprint: 3 };
  assert.equal(wearForAbility(wear, "sprint"), 3);
  assert.equal(wearForAbility(wear, "climbing"), 0);
  assert.equal(wearForAbility(undefined, "sprint"), 0);
  assert.equal(targetAfterWear(80, wear, "sprint"), 77);
  assert.equal(targetAfterWear(80, wear, "climbing"), 80);
  assert.equal(targetAfterWear(2, wear, "sprint"), 0);
});

function wearDb(rows, { fail = false } = {}) {
  const calls = [];
  return {
    calls,
    from(table) {
      calls.push(table);
      let ids = null;
      const result = () => fail
        ? { data: null, error: { message: "relation \"rider_wear\" does not exist" } }
        : { data: rows.filter((r) => !ids || ids.includes(r.rider_id)), error: null };
      const chain = {
        select() { return chain; },
        order() { return chain; },
        in(_c, list) { ids = list; calls.push(["in", list.length]); return Promise.resolve(result()); },
        range(from, to) { const r = result(); return Promise.resolve(r.error ? r : { data: r.data.slice(from, to + 1), error: null }); },
      };
      return chain;
    },
  };
}

test("loadRiderWear: alle rækker eller kun de bedte, tomt slid udelades", async () => {
  const rows = [
    { rider_id: "a", wear: { sprint: 2 } },
    { rider_id: "b", wear: {} },
    { rider_id: "c", wear: { climbing: 1, junk: 9 } },
  ];
  const all = await loadRiderWear({ supabase: wearDb(rows) });
  assert.deepEqual([...all.keys()].sort(), ["a", "c"]);
  assert.deepEqual(all.get("c"), { climbing: 1 });
  const some = await loadRiderWear({ supabase: wearDb(rows), riderIds: ["c", "x", "c", null] });
  assert.deepEqual([...some.keys()], ["c"]);
});

test("loadRiderWear: lange id-lister deles i bidder (URL-loftet #3030)", async () => {
  const ids = Array.from({ length: RIDER_WEAR_ID_CHUNK * 2 + 5 }, (_, i) => `r${i}`);
  const db = wearDb(ids.map((id) => ({ rider_id: id, wear: { sprint: 1 } })));
  const map = await loadRiderWear({ supabase: db, riderIds: ids });
  assert.equal(map.size, ids.length);
  assert.deepEqual(db.calls.filter((c) => Array.isArray(c)).map((c) => c[1]), [RIDER_WEAR_ID_CHUNK, RIDER_WEAR_ID_CHUNK, 5]);
});

test("loadRiderWear kaster ved databasefejl (fx manglende tabel), så ingen regner slid fra nul", async () => {
  await assert.rejects(loadRiderWear({ supabase: wearDb([], { fail: true }), riderIds: ["a"] }), /riderWear: read failed/);
  await assert.rejects(loadRiderWear({ supabase: wearDb([], { fail: true }) }), /riderWear: read failed/);
  await assert.rejects(loadRiderWear({ supabase: null }), /Supabase client required/);
});
