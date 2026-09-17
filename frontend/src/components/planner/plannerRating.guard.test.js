// #5321 — forward-guard for planlæggerens rating-tal.
//
// Bug'en: de fire planlægger-flader regnede selv ratingen ud af board-payloadens
// `abilities`, og det felt er løbsmotorens UDSNIT af evne-rækken (serveren
// projicerer med `?? 0`, fordi simulatoren kræver tal). Ratingens opskrift
// springer en manglende evne over i både tæller og nævner, så et udsnit giver et
// andet tal end hele rækken — samme rytter stod med ét tal her og et andet på
// Mit hold, rytterprofilen, auktionerne og ønskelisten.
//
// Rettelsen: serveren regner ratingen på hele evne-rækken (GET /peak-plans/board)
// og sender den færdig med. Denne test holder fladerne fast på det: ingen af dem
// må importere en rating-helper igen, og de skal læse feltet fra payloaden.
// Kilde-scanning er samme mønster som RiderTypeRadar.axisDomain.test.js.
//
// ═══ OMSKREVET EFTER #5352 (17/9) ═══
// Den sidste test her sluttede før med et selvtjek: preview-mockens rating måtte
// IKKE kunne genskabes af payloadens `abilities`. Det holdt kun fordi #5268
// havde givet teamwork/leadership vægt uden for motorens udsnit; #5352 rullede
// de vægte tilbage, og mocken giver nu lovligt samme tal begge veje. Selvtjekket
// er flyttet til en INJICERET opskrift-række hvor forskellen er garanteret af
// injektionen, og mock-testen holder sig til det den faktisk kan bevise:
// payloaden BÆRER et brugbart rating-felt pr. rytter.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { previewPlannerBoard } from "../../preview/plannerMock.js";
import { DISPLAY_RECIPES, ratingForRole } from "../../lib/generated/displayRecipes.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SURFACES = ["MasterCanvas.jsx", "MobileLanes.jsx", "PlannerDrawer.jsx", "PlannerSquad.jsx"];

const source = (file) => readFileSync(join(HERE, file), "utf8");

const heaviestAbility = (recipe) =>
  Object.entries(recipe.weights).sort((a, b) => b[1] - a[1])[0][0];

test("#5321: ingen planlægger-flade importerer en rating-helper", () => {
  for (const file of SURFACES) {
    assert.ok(
      !/from\s+["'][^"']*riderRating["']/.test(source(file)),
      `${file} importerer riderRating igen — ratingen skal komme fra serverens felt`,
    );
  }
});

test("#5321: ingen planlægger-flade regner en rating af board-payloadens abilities", () => {
  for (const file of SURFACES) {
    const text = source(file);
    assert.ok(
      !/riderOverallRating\s*\(/.test(text) && !/ratingForRole\s*\(/.test(text),
      `${file} regner stadig sin egen rating`,
    );
    assert.ok(/\.rating\b/.test(text), `${file} læser ikke rating-feltet fra payloaden`);
  }
});

test("#5321: board-payloaden bærer en rating pr. rytter", () => {
  const board = previewPlannerBoard();
  assert.ok(board.riders.length > 0, "mock-boardet har ingen ryttere at måle på");
  for (const rd of board.riders) {
    assert.ok(
      Number.isInteger(rd.rating) && rd.rating >= 0 && rd.rating <= 99,
      `rytter ${rd.id} mangler en brugbar rating i payloaden`,
    );
  }
});

test("#5321: et evne-udsnit kan ikke genskabe ratingen — hverken ved at mangle evnen eller ved at nulstille den", () => {
  // Injiceret række: rollens tungeste evne står højt, resten lavt. Forskellen er
  // garanteret af injektionen, ikke af hvad opskriften tilfældigvis indeholder i
  // dag — derfor må selvtjekket stå HER og ikke på preview-mocken.
  for (const recipe of DISPLAY_RECIPES) {
    const top = heaviestAbility(recipe);
    const full = Object.fromEntries(Object.keys(recipe.weights).map((k) => [k, k === top ? 99 : 20]));
    const fuld = ratingForRole(full, recipe.key);

    // (a) evnen mangler helt i udsnittet — springes over i tæller OG nævner.
    const udenEvnen = { ...full };
    delete udenEvnen[top];
    assert.equal(ratingForRole(udenEvnen, recipe.key), 20, `${recipe.key}: udsnit uden ${top}`);
    assert.ok(fuld > 20, `${recipe.key}: hele rækken gav samme tal som udsnittet uden ${top}`);

    // (b) serverens motor-projektion sætter en manglende evne til 0 (`?? 0`).
    // Den rå række springer NULL over; projektionen tæller den som et ægte nul.
    const raa = { ...full, [top]: null };
    const projiceret = { ...full, [top]: 0 };
    assert.equal(ratingForRole(raa, recipe.key), 20, `${recipe.key}: rå række med ${top} = NULL`);
    assert.ok(
      ratingForRole(projiceret, recipe.key) < 20,
      `${recipe.key}: projektionen trak ikke ${top}=0 ned`,
    );
  }
});
