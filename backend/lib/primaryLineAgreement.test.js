// DRIFT-VAGT: grafens primærlinje vælges to steder (#3666).
//
// ═══ HVORFOR DENNE FIL FINDES ═══
// Udvikling-fanen tegner tre linjer, hvor den ene er fremhævet, og OVEN PÅ den
// tegnes loft-zonen og projektions-båndet. Linjen vælges i frontend
// (`pickChartTypeKeys`); zonen og båndet vælges i backend (primærlinjen i
// GET /riders/:id/projection). Det er to implementeringer af samme regel:
// "rytterens primærtype hvis kendt, ellers den højest-ratede rolle nu".
//
// De var bundet sammen af INTET andet end en kommentar der sagde "samme valg som
// frontendens pickChartTypeKeys". Hvis den ene ændres, tegner fladen en linje for
// én rolle med en loft-zone der hører til en anden — og grafen lyver uden at
// nogen test fejler. Det er den samme fejlklasse som den håndholdte
// RATING_TYPE_WEIGHTS, der havde drevet fra backend i tre punkter uden at noget
// opdagede det.
//
// Testen kører BEGGE regler over de samme ryttere og kræver samme svar.
import test from "node:test";
import assert from "node:assert/strict";
import { RIDER_TYPE_KEYS } from "./riderTypes.js";
import { ratingFromAbilities } from "./scoutingReport.js";
import { pickChartTypeKeys } from "../../frontend/src/lib/developmentReport.js";

// Backendens regel, ordret som i routes/api.js' projection-handler: find
// primærtypen blandt rollerne, ellers den med højest `now`.
function backendPrimaryKey(abilities, primaryType) {
  const bands = RIDER_TYPE_KEYS.map((key) => ({ key, now: ratingFromAbilities(abilities, key) }));
  return (bands.find((b) => b.key === primaryType) ?? bands.reduce((a, b) => (b.now > a.now ? b : a), bands[0])).key;
}

const ABILITY_KEYS = [
  "climbing", "time_trial", "flat", "tempo", "sprint", "acceleration", "punch",
  "endurance", "recovery", "durability", "descending", "cobblestone",
  "positioning", "aggression", "tactics",
];

// Deterministisk pseudo-tilfældig bestand, så vagten dækker mere end ét tilfælde
// uden at være flaky.
function riderAt(seed) {
  const abilities = {};
  let x = seed;
  for (const key of ABILITY_KEYS) {
    x = (x * 1103515245 + 12345) % 2147483648;
    abilities[key] = Math.floor((x / 2147483648) * 60);
  }
  return abilities;
}

test("#3666 frontend og backend vælger SAMME primærlinje", () => {
  for (let seed = 1; seed <= 300; seed += 1) {
    const abilities = riderAt(seed);
    const primaryType = RIDER_TYPE_KEYS[seed % RIDER_TYPE_KEYS.length];
    const front = pickChartTypeKeys(abilities, primaryType, RIDER_TYPE_KEYS)[0];
    const back = backendPrimaryKey(abilities, primaryType);
    assert.equal(front, back, `uenige om primærlinjen ved seed ${seed} (${primaryType})`);
  }
});

test("#3666 de er ogsaa enige naar primaertypen mangler eller er ukendt", () => {
  // Fallback-grenen er den farligste: den vælger på rating, og rating er netop
  // det omlægningen ændrede. To forskellige tie-break-regler ville først vise sig
  // her, hos ryttere uden kendt rolle.
  for (const primaryType of [null, undefined, "ikke_en_rolle"]) {
    for (let seed = 1; seed <= 100; seed += 1) {
      const abilities = riderAt(seed * 7);
      const front = pickChartTypeKeys(abilities, primaryType, RIDER_TYPE_KEYS)[0];
      const back = backendPrimaryKey(abilities, primaryType);
      assert.equal(front, back, `uenige uden primærtype ved seed ${seed} (${String(primaryType)})`);
    }
  }
});
