// #5321 — forward-guard for planlæggerens rating-tal.
//
// Bug'en: de fire planlægger-flader regnede selv ratingen ud af board-payloadens
// `abilities`, og det felt er løbsmotorens UDSNIT af evne-rækken. Ratingens
// opskrift springer en manglende evne over i både tæller og nævner, så et udsnit
// giver et andet tal end hele rækken — samme rytter stod med ét tal her og et
// andet på Mit hold, rytterprofilen, auktionerne og ønskelisten.
//
// Rettelsen: serveren regner ratingen på hele evne-rækken (GET /peak-plans/board)
// og sender den færdig med. Denne test holder fladerne fast på det: ingen af dem
// må importere en rating-helper igen, og de skal læse feltet fra payloaden.
// Kilde-scanning er samme mønster som RiderTypeRadar.axisDomain.test.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { previewPlannerBoard } from "../../preview/plannerMock.js";
import { ratingForRole } from "../../lib/generated/displayRecipes.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SURFACES = ["MasterCanvas.jsx", "MobileLanes.jsx", "PlannerDrawer.jsx", "PlannerSquad.jsx"];

const source = (file) => readFileSync(join(HERE, file), "utf8");

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

test("#5321: board-payloaden bærer en rating pr. rytter, regnet på hele evne-rækken", () => {
  const board = previewPlannerBoard();
  assert.ok(board.riders.length > 0, "mock-boardet har ingen ryttere at måle på");
  for (const rd of board.riders) {
    assert.ok(
      Number.isInteger(rd.rating) && rd.rating >= 0 && rd.rating <= 99,
      `rytter ${rd.id} mangler en brugbar rating i payloaden`,
    );
    // Selve pointen: ratingen må IKKE kunne genskabes af det evne-udsnit
    // payloaden sender til løbsmotoren — så ville udsnittet være hele rækken, og
    // testen ville ikke bevise noget. Mindst én rytter skal vise forskellen.
  }
  const fromEngineSlice = board.riders.map((rd) => ratingForRole(rd.abilities, rd.primaryType));
  assert.notDeepEqual(
    fromEngineSlice,
    board.riders.map((rd) => rd.rating),
    "mocken ville give samme tal begge veje — så bevogter testen ikke længere bug'en",
  );
});
