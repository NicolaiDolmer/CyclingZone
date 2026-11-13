// #6110 frossen golden (#7587): med kontakten slukket (ingen developmentXp) er
// dags-tick'et, prognosen og akademiets roster-prognose bit-identiske med
// merge-base-koden. Fixturen er genereret af en separat checkout af basen (SHA i
// fixturen) og maa ALDRIG genereres igen med den nye kode for at faa testen groen.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { applyDailyTick } from "./dailyTraining.js";
import { prognoseAbilities, prognoseAbilityBands, PROGNOSIS_ENVELOPES } from "./riderPrognosis.js";
import { buildTypePrognosisBands } from "./scoutingReport.js";
import { rosterPrognosis } from "./academyIntake2View.ts";
import { tickAftryk, prognoseAftryk, rosterAftryk } from "./developmentXp6110Golden.mjs";

const FROSSEN = JSON.parse(readFileSync(new URL("./developmentXp6110Golden.fixture.json", import.meta.url), "utf8"));

test("#6110 golden: dags-tick'et uden XP er bit-identisk med merge-base", () => {
  assert.deepEqual(tickAftryk({ applyDailyTick }), FROSSEN.tick);
});

test("#6110 golden: prognosen uden XP (evne, baand, type) er bit-identisk med merge-base", () => {
  assert.deepEqual(
    prognoseAftryk({ prognoseAbilities, prognoseAbilityBands, PROGNOSIS_ENVELOPES, buildTypePrognosisBands }),
    FROSSEN.prognose,
  );
});

test("#6110 golden: akademiets roster-prognose uden XP er bit-identisk med merge-base", () => {
  assert.deepEqual(rosterAftryk({ rosterPrognosis }), FROSSEN.roster);
});

test("#6110 golden: scenarierne maaler noget (point koebes, baand findes)", () => {
  let medPoint = 0;
  tickAftryk({ applyDailyTick: (s) => {
    const t = applyDailyTick(s);
    if (Object.keys(t.gains).length > 0) medPoint += 1;
    return t;
  } });
  assert.ok(medPoint >= 20, `kun ${medPoint} tick gav point`);
  let medBaand = 0;
  rosterAftryk({ rosterPrognosis: (a) => {
    const p = rosterPrognosis(a);
    if (p.band) medBaand += 1;
    return p;
  } });
  assert.ok(medBaand >= 20, `kun ${medBaand} roster-prognoser havde et baand`);
});
