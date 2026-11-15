// #7801 svartid: prognosens opslag sendes samtidig. Tal og fejlgrene skal vaere bit-identiske.
//
// Facit (__fixtures__/forecast7801Golden.json) er frosset paa en FROSSET kopi af merge-base-koden
// (se "frosset_fra" i filen) med forecast7801GoldenRunner.mjs, og maa aldrig genskabes med ny kode:
// flytter et aftryk sig, har ombygningen aendret noget, der skulle staa stille. Facit er kun
// fingeraftryk (hard rule 17). Decimaltal er afrundet foer hash, saa Windows og Linux er ens.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { forecastCalls, runGolden } from "./forecast7801GoldenRunner.mjs";

const FROZEN = JSON.parse(readFileSync(new URL("./__fixtures__/forecast7801Golden.json", import.meta.url), "utf8"));
const now = await runGolden(FROZEN);

test("facit er frosset paa en merge-base og daekker kontakter og fejlgrene", () => {
  assert.match(FROZEN.frosset_fra, /^[0-9a-f]{40}$/);
  assert.ok(Object.keys(FROZEN.kontakt).length >= 6);
  const cells = Object.values(FROZEN.fejl).flatMap((teams) => Object.values(teams).map((byTarget) => Object.keys(byTarget).length));
  assert.ok(cells.every((n) => n >= 2), "hver fejlflade har mindst ét maal");
  assert.ok(cells.reduce((a, b) => a + b, 0) >= 300, "mange fejlgrene er frosset");
});

for (const variant of Object.keys(FROZEN.kontakt)) {
  test(`kontakter (${variant}): hvert svar er praecis som paa merge-base`, () => {
    assert.deepEqual(now.kontakt[variant], FROZEN.kontakt[variant]);
  });
}

for (const scenario of Object.keys(FROZEN.fejl)) {
  test(`fejlgrene (${scenario}): et opslag, der ikke kan laeses, giver praecis det samme svar eller den samme fejl som paa merge-base`, () => {
    assert.deepEqual(now.fejl[scenario], FROZEN.fejl[scenario]);
  });
}

// ── Svartid: kun antal ventetider, aldrig tal ──────────────────────────────────────────────────
// En runde er en ventetid paa databasen. Loftet er det, ombygningen koster; det maa ikke vokse.
// Foer ombygningen (merge-base) var det 22 ventetider (36 for et hold med straks-stempler); antallet
// kald er uaendret. Hold A har stempler paa Traen nu-dagen: straks-opslaget er en lang kaede for sig.
const ROUND_CEILING = {
  midt_paa_dagen: { "team-a": 10, "team-b": 10 },
  morgen_foer_etaper: { "team-a": 10, "team-b": 10 },
  aften_alle_koert: { "team-a": 10, "team-b": 10 },
  traen_nu_trykket: { "team-a": 23, "team-b": 10 },
  model_v2_slukket: { "team-a": 10, "team-b": 10 },
  laege_byttet: { "team-a": 10, "team-b": 10 },
};
test("prognosen venter hoejst det antal gange paa databasen, ombygningen giver (foer: 22 og 36)", async () => {
  const over = [];
  for (const [scenario, byTeam] of Object.entries(ROUND_CEILING)) {
    for (const [team, ceiling] of Object.entries(byTeam)) {
      const { runder } = await forecastCalls(scenario, team);
      if (runder > ceiling) over.push(`${scenario} / ${team}: ${runder} ventetider (loft ${ceiling})`);
    }
  }
  assert.deepEqual(over, []);
});

test("prognosen sender de opslag, der ikke afhaenger af hinanden, i samme runde, og ingen kald oeges paa en almindelig dag", async () => {
  // Kaldene er de samme som paa merge-base (35 for et hold uden stempler); kun ventetiden er kortere.
  assert.equal((await forecastCalls("midt_paa_dagen", "team-b")).kald, 35);
  assert.equal((await forecastCalls("aften_alle_koert", "team-a")).kald, 35);
});
