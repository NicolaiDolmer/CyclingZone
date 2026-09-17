// #5321 — backend-siden af "NULL tæller aldrig som 0" + golden-guarden.
//
// `ratingFromAbilities` (scoutingReport.js) er den funktion Scouting-fanen og
// Mit hold's server-svar bruger. Den delegerer til `ratingForRole` i
// weights/displayRecipes.js — samme kilde som frontendens genererede kopi.
// Denne fil binder de to sammen på ET fast fixture-sæt, så de ikke kan glide
// fra hinanden igen: 15/9 viste samme rytter 41 på én flade og 44 på en anden,
// fordi `Number(null)` er 0 og fladerne hentede hver sit kolonnesæt.
//
// Fixturen ligger i frontend/src/lib/__fixtures__/ratingGolden.5321.json — ÉT
// sted, læst af både frontendens og backendens vagt. To kopier ville før eller
// siden være to forskellige sandheder om hvad spilleren ser.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { ratingFromAbilities } from "./scoutingReport.js";
import { DISPLAY_RECIPE_KEYS, PENDING_DISPLAY_ABILITIES, abilityValue } from "./weights/displayRecipes.js";
import { ratingForRole as frontendRatingForRole } from "../../frontend/src/lib/generated/displayRecipes.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const GOLDEN = JSON.parse(readFileSync(
  join(REPO_ROOT, "frontend", "src", "lib", "__fixtures__", "ratingGolden.5321.json"), "utf8"));

const BASE = Object.freeze({
  climbing: 40, time_trial: 45, flat: 62, tempo: 50, sprint: 70, acceleration: 66,
  punch: 38, endurance: 48, recovery: 43, durability: 55, descending: 36,
  cobblestone: 41, positioning: 58, aggression: 34, tactics: 30,
});

// ── abilityValue: selve rodårsagen ───────────────────────────────────────────
test("#5321 abilityValue: null, undefined og tom streng er 'ingen værdi'", () => {
  for (const tom of [null, undefined, "", "   ", NaN, Infinity, true, false, {}, []]) {
    assert.equal(abilityValue(tom), null, `${JSON.stringify(tom) ?? String(tom)} må ikke give et tal`);
  }
});

test("#5321 abilityValue: tal og tal-strenge tæller med, inkl. et ægte 0", () => {
  assert.equal(abilityValue(0), 0);
  assert.equal(abilityValue(42), 42);
  assert.equal(abilityValue("0"), 0);
  assert.equal(abilityValue("42"), 42);
  // smallint fra PostgREST kan komme som streng afhængigt af klient/kolonne.
  assert.equal(abilityValue("07"), 7);
});

// ── ratingFromAbilities ──────────────────────────────────────────────────────
test("#5321: NULL-kolonne og manglende nøgle giver samme rating (ratingFromAbilities)", () => {
  const medNull = { ...BASE, teamwork: null, leadership: null };
  const udenNoegler = { ...BASE };
  for (const role of DISPLAY_RECIPE_KEYS) {
    assert.equal(
      ratingFromAbilities(medNull, role), ratingFromAbilities(udenNoegler, role),
      `${role}: NULL må ikke tælle som 0 — det var #5321's rodårsag.`
    );
  }
});

test("#5321: et ægte 0 tæller med i backend-beregningen", () => {
  const medNul = { ...BASE, sprint: 0 };
  assert.ok(ratingFromAbilities(medNul, "sprinter") < ratingFromAbilities(BASE, "sprinter"));
  assert.notEqual(ratingFromAbilities({ ...BASE, sprint: null }, "sprinter"),
    ratingFromAbilities(medNul, "sprinter"));
});

test("#5321: de udskudte evner flytter ikke ratingen", () => {
  for (const evne of PENDING_DISPLAY_ABILITIES) {
    for (const role of DISPLAY_RECIPE_KEYS) {
      assert.equal(
        ratingFromAbilities({ ...BASE, [evne]: 1 }, role),
        ratingFromAbilities({ ...BASE, [evne]: 99 }, role),
        `${role}: ${evne} er udskudt (PENDING_DISPLAY_ABILITIES) og må ikke tælle endnu.`
      );
    }
  }
});

// ── Golden + paritet ─────────────────────────────────────────────────────────
test("#5321 golden: backendens rating pr. rolle er uændret for hele fixture-sættet", () => {
  const afvigelser = [];
  for (const rider of GOLDEN.riders) {
    for (const role of GOLDEN.roles) {
      const faktisk = ratingFromAbilities(rider.abilities, role);
      if (faktisk !== rider.ratings[role]) {
        afvigelser.push(`${rider.id}/${role}: frosset ${rider.ratings[role]} → nu ${faktisk}`);
      }
    }
  }
  assert.deepEqual(
    afvigelser, [],
    `Synlige ratings har flyttet sig:\n${afvigelser.join("\n")}\n\n`
    + "Ejerens regel 17/9: spillernes synlige ratings må aldrig falde uden hans "
    + "vidende. Opdatér kun frontend/src/lib/__fixtures__/ratingGolden.5321.json i "
    + "en PR der linker til et eksplicit ejer-go på netop dette skridt (#5321)."
  );
});

test("#5321 paritet: backendens ratingFromAbilities = frontendens ratingForRole på fixturen", () => {
  const afvigelser = [];
  for (const rider of GOLDEN.riders) {
    for (const role of GOLDEN.roles) {
      const be = ratingFromAbilities(rider.abilities, role);
      const fe = frontendRatingForRole(rider.abilities, role);
      if (be !== fe) afvigelser.push(`${rider.id}/${role}: backend ${be} ≠ frontend ${fe}`);
    }
  }
  assert.deepEqual(
    afvigelser, [],
    `Server og klient viser ikke samme rating:\n${afvigelser.join("\n")}\n\n`
    + "Kør: node scripts/generate-ability-registry.mjs"
  );
});

test("#5321: fixturen dækker alle 8 roller og bærer sin ejer-go-header", () => {
  assert.deepEqual([...GOLDEN.roles].sort(), [...DISPLAY_RECIPE_KEYS].sort());
  assert.ok(GOLDEN.riders.length >= 8, "fixturen skal have mindst 8 ryttere");
  const header = (GOLDEN._README ?? []).join(" ");
  assert.match(header, /ejer-go/i, "fixturen skal bære reglen om ejer-go i sin header");
  assert.match(header, /issues\/5321/, "fixturen skal linke til beslutningen");
});
