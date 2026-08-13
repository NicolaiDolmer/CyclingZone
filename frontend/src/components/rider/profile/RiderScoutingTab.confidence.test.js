// #3667 forward-guard — scouting-chippen må aldrig igen hedde "tillid".
//
// backend/lib/scoutingReport.js: `confidence = own || level >= maxLevel ? "high"
// : level >= 2 ? "medium" : "low"`. Feltet måler hvor FULDT scoutet rytteren er,
// ikke hvor præcist estimatet er — præcisionen afhænger alene af spejderens
// rating (scoutEngine.minHalfWidthByScoutRating), og båndet er 10 rating-point
// bredt med standard-spejderen mod 6 med en topratet. Chippen hed alligevel
// "Høj tillid" for alle tre, og modsagde dermed `recalcNote` på samme kort.
//
// Testen holder tre ting fast:
//   1) hver confidence-værdi har BÅDE en label og en forklarende titel, i en+da
//   2) komponenten slår titlen op (ellers er nøglerne døde)
//   3) ordet "tillid"/"confidence" er ikke sneget tilbage i mærkaterne
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const CONFIDENCE_VALUES = ["high", "medium", "low"];
const LOCALES = ["en", "da"];

function loadRiderLocale(lang) {
  const path = fileURLToPath(new URL(`../../../../public/locales/${lang}/rider.json`, import.meta.url));
  return JSON.parse(readFileSync(path, "utf8"));
}

function componentSource() {
  const path = fileURLToPath(new URL("./RiderScoutingTab.jsx", import.meta.url));
  return readFileSync(path, "utf8");
}

test("hver confidence-værdi har label + forklarende titel i begge sprog", () => {
  for (const lang of LOCALES) {
    const scouting = loadRiderLocale(lang).profile.scouting;
    for (const value of CONFIDENCE_VALUES) {
      const label = scouting[`confidence_${value}`];
      const title = scouting[`confidenceTitle_${value}`];
      assert.ok(label && label.trim(), `${lang}: profile.scouting.confidence_${value} mangler`);
      assert.ok(title && title.trim(), `${lang}: profile.scouting.confidenceTitle_${value} mangler`);
      assert.ok(
        title.length > label.length,
        `${lang}: confidenceTitle_${value} skal forklare mærkatet, ikke gentage det`,
      );
    }
    assert.ok(
      scouting.verdictIsRead && scouting.verdictIsRead.trim(),
      `${lang}: profile.scouting.verdictIsRead mangler — dommen skal stå som en vurdering, ikke en kendsgerning`,
    );
  }
});

test("komponenten slår både mærkat og titel op, så nøglerne ikke er døde", () => {
  const src = componentSource();
  assert.match(src, /confidenceTitle_\$\{verdict\.confidence\}/, "chippen mangler sin title-opslag");
  assert.match(src, /confidence_\$\{verdict\.confidence\}/, "chippen mangler sit label-opslag");
  assert.match(src, /profile\.scouting\.verdictIsRead/, "verdict-kortet viser ikke verdictIsRead");
});

test("mærkaterne lover ikke tillid eller præcision — de beskriver scouting-graden", () => {
  for (const lang of LOCALES) {
    const scouting = loadRiderLocale(lang).profile.scouting;
    for (const value of CONFIDENCE_VALUES) {
      const label = scouting[`confidence_${value}`].toLowerCase();
      for (const forbidden of ["confidence", "tillid", "precision", "præcis", "accurate", "sikker"]) {
        assert.ok(
          !label.includes(forbidden),
          `${lang}: confidence_${value} = "${label}" lover "${forbidden}" — feltet måler scouting-grad, ikke præcision (#3667)`,
        );
      }
    }
  }
});
