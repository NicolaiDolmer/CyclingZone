// #7801 svartid: databasekald for Træning og auto-udfyld med fatigue_now_7801 tændt.
//
// Målingen 14/11 (docs/audits/2026-11-14-7801-svartid-taendt.md) fandt, at Træning regnede
// aftenens prognose efter de andre opslag og læste kontakter og lægeopslag igen, og at
// auto-udfyld læste ét løb ad gangen. Denne prøve tæller kald og ventetider på dommerens
// opdigtede verdener og fejler, hvis antallet stiger igen. Tallene er loftet efter rettelsen.
// "Ventetid" = en runde, hvor visningen venter på databasen (se dommerens harness).

import test from "node:test";
import assert from "node:assert/strict";

import { SCENARIO_NAMES, countCalls, runSurface } from "./dommer7801RestByg.harness.mjs";
import { sharedReadsClient } from "./riderFatigueNow.js";

// [kald, ventetider] pr. scenarie efter rettelsen. Før rettelsen (main 14/11) var Træning med en
// etape i morgen 48-49 kald og 28 ventetider, og auto-udfyld til fem løb 36-39 kald og 33-36 ventetider.
const CEILING = {
  "traening|team-a": { midt_paa_dagen: [14, 6], morgen_foer_etaper: [14, 6], aften_alle_koert: [40, 20], hviledag: [16, 8], traen_nu_trykket: [23, 12], model_v2_slukket: [10, 6], laege_byttet: [13, 6] },
  "traening|team-b": { midt_paa_dagen: [39, 20], morgen_foer_etaper: [39, 20], aften_alle_koert: [39, 20], hviledag: [15, 8], traen_nu_trykket: [39, 20], model_v2_slukket: [37, 21], laege_byttet: [39, 20] },
  "autoudfyld|team-a": { midt_paa_dagen: [16, 5], morgen_foer_etaper: [16, 5], aften_alle_koert: [16, 5], hviledag: [16, 5], traen_nu_trykket: [48, 20], model_v2_slukket: [9, 3], laege_byttet: [15, 4] },
  "autoudfyld|team-b": { midt_paa_dagen: [15, 4], morgen_foer_etaper: [15, 4], aften_alle_koert: [15, 4], hviledag: [15, 4], traen_nu_trykket: [15, 4], model_v2_slukket: [9, 3], laege_byttet: [15, 4] },
};

test("loftet dækker alle dommerens scenarier", () => {
  for (const key of Object.keys(CEILING)) assert.deepEqual(Object.keys(CEILING[key]).sort(), [...SCENARIO_NAMES].sort(), key);
});

for (const [key, byScenario] of Object.entries(CEILING)) {
  test(`${key}, tændt: aldrig flere kald eller ventetider end efter rettelsen`, async () => {
    const over = [];
    for (const [name, [maxCalls, maxRounds]] of Object.entries(byScenario)) {
      const { kald, runder } = countCalls((await runSurface(name, "on", key)).log);
      if (kald > maxCalls || runder > maxRounds) over.push(`${name}: ${kald} kald og ${runder} ventetider (loft ${maxCalls} og ${maxRounds})`);
    }
    assert.deepEqual(over, []);
  });
}

test("Træning med en etape i morgen: prognosen læser ikke igen, hvad tallet nu allerede har læst", async () => {
  const { log } = await runSurface("aften_alle_koert", "on", "traening|team-b");
  const count = (target) => log.filter((entry) => entry.target === target).length;
  for (const target of [
    "app_config:fatigue_now_7801", "app_config:condition_model_v2", "app_config:training_condition_per_date",
    "app_config:training_tick_per_race_day", "team_facilities", "team_staff",
  ]) assert.equal(count(target), 1, `${target} læses én gang`);
});

test("auto-udfyld: flere løb koster ikke flere ventetider, og datoens opslag læses én gang", async () => {
  const { log } = await runSurface("midt_paa_dagen", "on", "autoudfyld|team-a");
  const { byTarget } = countCalls(log);
  assert.equal(byTarget["app_config:condition_model_v2"], 1);
  assert.equal(byTarget["rider_derived_abilities"] ?? 0, 0, "evnerne kommer fra kalderen");
  // Fem løb, fire planlagte på to datoer: én starttid pr. løb og ét belastningsopslag pr. dato.
  assert.equal(byTarget.race_stage_schedule, 5);
  assert.ok(byTarget.training_race_loads <= 2, `${byTarget.training_race_loads} belastningsopslag`);
});

// ── sharedReadsClient ───────────────────────────────────────────────────────────────────────
function countingClient(answer) {
  const sent = [];
  const from = (table) => {
    const steps = [];
    const query = new Proxy({}, {
      get(_t, prop) {
        if (prop === "then") return (resolve, reject) => {
          sent.push({ table, steps: steps.map(([m]) => m) });
          return Promise.resolve(answer(table, steps)).then(resolve, reject);
        };
        if (typeof prop === "symbol") return undefined;
        return (...args) => { steps.push([prop, args]); return query; };
      },
    });
    return query;
  };
  return { client: { from, rpc: function rpc() { return this === client.client ? "bundet" : "ubundet"; } }, sent };
}
let client;

test("sharedReadsClient: samme læsning sendes én gang; andre filtre sendes for sig", async () => {
  client = countingClient(() => ({ data: [{ value: "on" }], error: null }));
  const reads = sharedReadsClient(client.client);
  await reads.from("app_config").select("value").eq("key", "a").maybeSingle();
  await reads.from("app_config").select("value").eq("key", "a").maybeSingle();
  await reads.from("app_config").select("value").eq("key", "b").maybeSingle();
  await reads.from("x").select("id").in("id", new Set(["1"]));
  await reads.from("x").select("id").in("id", new Set(["2"]));
  assert.equal(client.sent.length, 4);
  assert.equal(reads.rpc(), "bundet", "andre metoder går til den rigtige klient");
});

test("sharedReadsClient: fejl huskes ikke, skrivninger går altid igennem, svaret er en kopi", async () => {
  let fail = true;
  client = countingClient((table) => (table === "f" && fail ? { data: null, error: { message: "nede" } } : { data: [{ n: 1, nested: { v: 1 } }], error: null }));
  const reads = sharedReadsClient(client.client);
  assert.ok((await reads.from("f").select("*")).error);
  fail = false;
  assert.equal((await reads.from("f").select("*")).error, null, "nyt forsøg går til databasen");
  await reads.from("w").update({ a: 1 }).eq("id", 1);
  await reads.from("w").update({ a: 1 }).eq("id", 1);
  const first = await reads.from("r").select("*");
  first.data[0].nested.v = 99;
  const second = await reads.from("r").select("*");
  assert.equal(second.data[0].nested.v, 1, "en kalders ændring når ikke den næste");
  assert.deepEqual(client.sent.map((s) => s.table), ["f", "f", "w", "w", "r"]);
});
