// KONSISTENS-VAGT for preview-seedet (#3666).
//
// ═══ HVORFOR DENNE FIL FINDES ═══
// Preview er det eneste sted ejeren kan godkende en ændring FØR den er live, og
// den godkendelse er kun værd noget hvis fladerne er enige med hinanden.
//
// De var de ikke. Rytterprofilens hero regnede rating ud af rytterens EGNE evner
// (79), mens Scouting-fanen og Udvikling-grafen kom fra håndskrevne fixtures der
// var afledt af en HISTORIK-række (50). Samme rytter, samme rolle, tre tal — og
// ingen test kunne se det, fordi hver fixture var intern konsistent for sig selv.
//
// På den gamle anker-normaliserede skala var forskellen usynlig: normaliseringen
// strakte alligevel alt mod to populations-ankre, så ingen forventede at to
// kilder gav samme tal. Den nye skala er absolut — rating ER evnerne — og
// dermed bliver ethvert brud mellem kilderne til to tal på én skærm.
//
// Testen binder derfor de afledte fixtures til rytteren de påstår at beskrive.
// Den regner IKKE loft-båndene efter (de kræver backendens seededUnit-bias, som
// frontend hverken har eller skal have) — den pinner det der kunne modsige sig
// selv på skærmen: `now`-tallene og deres kilde.
import test from "node:test";
import assert from "node:assert/strict";

import { ratingForRole, DISPLAY_RECIPE_KEYS } from "../lib/generated/displayRecipes.js";
import { flattenAbilities, ABILITY_KEYS } from "../lib/abilities.js";
import { riderOverallRating } from "../lib/riderRating.js";
import {
  RIDERS, SEED_ABILITY_CAPS, SEED_DEVELOPMENT, SEED_PROJECTION, SEED_SCOUTING_REPORT,
} from "./seedData.js";
import { restRows } from "./mockHandlers.js";

const OWN = RIDERS.find((r) => r.id === "rider-1");
const flat = flattenAbilities(OWN);
const caps = SEED_ABILITY_CAPS["rider-1"];

test("heroens rating, projektionen og scouting-rapporten taler om samme tal", () => {
  const hero = riderOverallRating(flat);
  const fromReport = SEED_SCOUTING_REPORT.types.find(
    (t) => t.key === SEED_SCOUTING_REPORT.primaryKey,
  );

  assert.equal(SEED_SCOUTING_REPORT.primaryKey, OWN.primary_type,
    "rapportens primaryKey skal være rytterens egen rolle");
  assert.equal(fromReport.now, hero,
    "scouting-rapportens egen-rolle-rating skal være heroens tal");
  assert.equal(SEED_PROJECTION.now, hero,
    "projektionens now skal være heroens tal");
  assert.equal(SEED_PROJECTION.primaryKey, SEED_SCOUTING_REPORT.primaryKey);
});

test("Udvikling-grafens sidste punkt er rytterens nuværende evner", () => {
  const last = SEED_DEVELOPMENT[SEED_DEVELOPMENT.length - 1].abilities;
  for (const key of Object.keys(last)) {
    assert.equal(last[key], OWN.rider_derived_abilities[key],
      `historikkens sidste snapshot afviger på ${key} — grafen ville ende et andet sted end heroen`);
  }
  assert.equal(ratingForRole(last, OWN.primary_type), riderOverallRating(flat));
});

test("historikken er monoton på de evner der vokser, og rører ikke resten", () => {
  const GROWS = ["flat", "sprint", "acceleration"];
  for (let i = 1; i < SEED_DEVELOPMENT.length; i += 1) {
    const prev = SEED_DEVELOPMENT[i - 1].abilities;
    const cur = SEED_DEVELOPMENT[i].abilities;
    for (const key of Object.keys(cur)) {
      if (GROWS.includes(key)) assert.ok(cur[key] > prev[key], `${key} skal vokse ved snapshot ${i}`);
      else assert.equal(cur[key], prev[key], `${key} skulle stå stille i historikken`);
    }
  }
});

test("hver rolle i rapporten bærer den rating rytterens evner faktisk giver", () => {
  assert.equal(SEED_SCOUTING_REPORT.types.length, DISPLAY_RECIPE_KEYS.length,
    "rapporten skal dække alle otte roller");
  for (const row of SEED_SCOUTING_REPORT.types) {
    assert.equal(row.now, ratingForRole(flat, row.key), `now er forkert for ${row.key}`);
    assert.ok(row.ceilLo >= row.now, `loftet må ikke ligge under nu-niveauet (${row.key})`);
    assert.ok(row.ceilHi >= row.ceilLo, `båndet må ikke være vendt om (${row.key})`);
  }
});

test("loft-båndet rummer den sandhed det maskerer", () => {
  // Båndet er [center ± halvbredde] hvor center = sandhed + bias og |bias| er
  // højst en halv halvbredde (CEIL_BIAS_FACTOR = 0,5). Sandheden kan derfor
  // ALDRIG falde uden for båndet — hvis den gør, er seedet regnet med andre
  // lofter end dem der står på rytteren.
  for (const row of SEED_SCOUTING_REPORT.types) {
    const truth = ratingForRole(caps, row.key);
    assert.ok(truth >= row.ceilLo && truth <= row.ceilHi,
      `loft-sandheden ${truth} for ${row.key} ligger uden for båndet ${row.ceilLo}-${row.ceilHi}`);
  }
});

test("hver seed-rytter har lofter, så potentiale kan vises på preview", () => {
  for (const rider of RIDERS) {
    const abilities = rider.rider_derived_abilities;
    if (!abilities) continue;
    const riderCaps = SEED_ABILITY_CAPS[rider.id];
    assert.ok(riderCaps,
      `${rider.id} mangler lofter — potentiel rating (#2454) ville stå tom på preview`);
    for (const key of ABILITY_KEYS) {
      assert.ok(riderCaps[key] >= abilities[key],
        `${rider.id}: loftet for ${key} (${riderCaps[key]}) ligger under evnen selv (${abilities[key]})`);
    }
  }
});

test("mocken lækker ALDRIG rå lofter til klienten", () => {
  // #1162: `ability_caps` er invertérbar til det server-skjulte potentiale, og
  // frontendens ABILITY_SELECT henter kun de 15 evne-nøgler. Lå lofterne på
  // rytter-rækken, ville preview servere et felt produktionen aldrig sender —
  // og en flade kunne se ud til at virke på data der ikke findes i drift.
  // Det var præcis den fejl denne fil blev skrevet efter at have begået.
  const rows = [
    ...restRows("riders", "http://x/rest/v1/riders?select=*"),
    ...restRows("rider_derived_abilities", "http://x/rest/v1/rider_derived_abilities?select=*"),
  ];
  const leaked = JSON.stringify(rows);
  assert.ok(!leaked.includes("ability_caps"),
    "mocken serverer ability_caps — rå lofter må aldrig forlade serveren");
  assert.ok(!leaked.includes("hidden_potential"),
    "mocken serverer hidden_potential — server-skjult felt");
});
