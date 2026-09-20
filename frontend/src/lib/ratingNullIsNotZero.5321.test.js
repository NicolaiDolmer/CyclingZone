// #5321 — NULL tæller aldrig som 0, og synlige ratings flytter sig ikke i tavshed.
//
// BAGGRUNDEN: #5268 (PR #5280, 15/9) gav to helt nye mentale evner en vægt i
// fire af de otte visnings-opskrifter. Alle eksisterende ryttere havde NULL i
// de to kolonner. `ratingForRole` regnede `Number(abilities[ability])`, og
// `Number(null)` er 0 — et finite tal — så NULL talte som et ægte nul i BÅDE
// tæller og nævner. En flade der hentede kolonnerne (Mit hold, Scouting-fanen)
// viste derfor et lavere tal end en flade der ikke gjorde (rytterprofilens
// hero, hvor nøglen manglede helt og `Number(undefined)` blev NaN og sprunget
// over). Samme rytter, to tal, ingen af dem forkerte efter koden — og hele
// bestandens synlige rating faldt uden at en eneste rytter var blevet dårligere.
//
// Testene her er delt i tre:
//   1. NULL/manglende nøgle/tom streng giver PRÆCIS samme rating.
//   2. Et ægte 0 tæller med (der findes ryttere i prod med rolle-rating 0, #3666).
//   3. Golden: ratingen pr. rolle er frosset i __fixtures__/ratingGolden.5321.json.
//      Ændrer nogen opskriften eller regnestykket, bliver denne test rød.
//
// Paritetsdelen importerer backendens `displayRecipes.js` direkte. Den fil har
// NUL imports (samme mønster som auctionValueUpdateWindow.parity.test.js), så
// den trækker ikke backend-afhængigheder ind i frontendens CI-job.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { DISPLAY_RECIPE_KEYS, ratingForRole } from "./generated/displayRecipes.js";
import {
  PENDING_DISPLAY_ABILITIES,
  ratingForRole as backendRatingForRole,
} from "../../../backend/lib/weights/displayRecipes.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDEN = JSON.parse(readFileSync(join(HERE, "__fixtures__", "ratingGolden.5321.json"), "utf8"));

// En komplet, syntetisk række. Basen er den samme i alle tre varianter nedenfor,
// så det ENESTE der adskiller dem er hvordan `teamwork`/`leadership` optræder.
const BASE = Object.freeze({
  climbing: 40, time_trial: 45, flat: 62, tempo: 50, sprint: 70, acceleration: 66,
  punch: 38, endurance: 48, recovery: 43, durability: 55, descending: 36,
  cobblestone: 41, positioning: 58, aggression: 34, tactics: 30,
});

// ── 1. NULL er ikke 0 ────────────────────────────────────────────────────────
test("#5321: en NULL-kolonne giver samme rating som en manglende nøgle", () => {
  const medNull = { ...BASE, teamwork: null, leadership: null };
  const udenNoegler = { ...BASE };
  for (const role of DISPLAY_RECIPE_KEYS) {
    assert.equal(
      ratingForRole(medNull, role), ratingForRole(udenNoegler, role),
      `${role}: NULL og manglende nøgle skal give samme rating. `
      + "Det var præcis her #5321 opstod: to flader hentede hver sit kolonnesæt "
      + "og viste derfor to tal for samme rytter."
    );
  }
});

test("#5321: undefined og tom streng behandles som 'ingen værdi', ikke som 0", () => {
  const udenNoegler = { ...BASE };
  for (const tom of [undefined, "", "   "]) {
    const raekke = { ...BASE, teamwork: tom, leadership: tom };
    for (const role of DISPLAY_RECIPE_KEYS) {
      assert.equal(
        ratingForRole(raekke, role), ratingForRole(udenNoegler, role),
        `${role}: ${JSON.stringify(tom)} må ikke tælle som et tal. Number("") er 0.`
      );
    }
  }
});

test("#5321: et ægte 0 tæller med og trækker ratingen ned", () => {
  // `sprint` har den tungeste vægt hos sprinteren, så et ægte nul dér SKAL
  // flytte tallet. Gør det ikke det, har fixet slugt en rigtig værdi.
  const medNul = { ...BASE, sprint: 0 };
  assert.ok(
    ratingForRole(medNul, "sprinter") < ratingForRole(BASE, "sprinter"),
    "et ægte 0 er en værdi, ikke 'mangler' — den skal tælle i både tæller og nævner"
  );
  // Og et 0 er ikke det samme som at nøglen mangler.
  const uden = { ...BASE };
  delete uden.sprint;
  assert.notEqual(ratingForRole(medNul, "sprinter"), ratingForRole(uden, "sprinter"));
});

test("#5321: en række uden nogen af rollens evner giver null, ikke 0", () => {
  assert.equal(ratingForRole({}, "sprinter"), null);
  assert.equal(ratingForRole({ teamwork: 50 }, "sprinter"), null);
  assert.equal(ratingForRole(null, "sprinter"), null);
  assert.equal(ratingForRole(BASE, "findes-ikke"), null);
});

// ── 2. De udskudte evner ─────────────────────────────────────────────────────
test("#5321: de udskudte evner påvirker ikke ratingen før de har værdier på alle ryttere", () => {
  for (const evne of PENDING_DISPLAY_ABILITIES) {
    const lav = { ...BASE, [evne]: 1 };
    const hoej = { ...BASE, [evne]: 99 };
    for (const role of DISPLAY_RECIPE_KEYS) {
      assert.equal(
        ratingForRole(lav, role), ratingForRole(hoej, role),
        `${role}: ${evne} står i PENDING_DISPLAY_ABILITIES og må derfor ikke flytte ratingen. `
        + "Skal den tælle med, kræver det et ejer-go (#5351) og en opdateret golden-fixture."
      );
    }
  }
});

// ── 3. Golden + paritet ──────────────────────────────────────────────────────
test("#5321 golden: ratingen pr. rolle er uændret for hele fixture-sættet", () => {
  assert.deepEqual(
    [...GOLDEN.roles].sort(), [...DISPLAY_RECIPE_KEYS].sort(),
    "fixturen dækker ikke de samme roller som opskrifterne"
  );
  const afvigelser = [];
  for (const rider of GOLDEN.riders) {
    for (const role of GOLDEN.roles) {
      const faktisk = ratingForRole(rider.abilities, role);
      if (faktisk !== rider.ratings[role]) {
        afvigelser.push(`${rider.id}/${role}: frosset ${rider.ratings[role]} → nu ${faktisk}`);
      }
    }
  }
  assert.deepEqual(
    afvigelser, [],
    `Synlige ratings har flyttet sig:\n${afvigelser.join("\n")}\n\n`
    + "Denne test er IKKE støj. Ejerens regel 17/9: spillernes synlige ratings må "
    + "aldrig falde uden hans vidende. Opdatér kun __fixtures__/ratingGolden.5321.json "
    + "i en PR der linker til et eksplicit ejer-go på netop dette skridt (#5321)."
  );
});

test("#5321 golden: NULL-rytteren og nøgle-løs-rytteren har identiske tal i fixturen", () => {
  // Fixturens golden-02 (NULL i begge kolonner) og golden-03 (kolonnerne mangler)
  // er den samme rytter set fra to flader. Er de ikke ens, er #5321 tilbage.
  const medNull = GOLDEN.riders.find((r) => r.id === "golden-02");
  const udenNoegler = GOLDEN.riders.find((r) => r.id === "golden-03");
  assert.ok(medNull && udenNoegler, "fixturen mangler NULL/nøgle-løs-parret");
  assert.deepEqual(medNull.ratings, udenNoegler.ratings);
});

test("#5321 paritet: frontendens ratingForRole er bit-identisk med backendens på hele fixturen", () => {
  const afvigelser = [];
  for (const rider of GOLDEN.riders) {
    for (const role of GOLDEN.roles) {
      const fe = ratingForRole(rider.abilities, role);
      const be = backendRatingForRole(rider.abilities, role);
      if (fe !== be) afvigelser.push(`${rider.id}/${role}: frontend ${fe} ≠ backend ${be}`);
    }
  }
  assert.deepEqual(
    afvigelser, [],
    `Frontend og backend regner ikke ens:\n${afvigelser.join("\n")}\n\n`
    + "Kør: node scripts/generate-ability-registry.mjs"
  );
});
