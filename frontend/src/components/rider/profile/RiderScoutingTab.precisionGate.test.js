// #3671 forward-guard — den dæmpede scout-knap.
//
// Det RELATIVE gulv (backend/lib/scoutEngine.js, scoutHalfWidth) betyder at
// intet scout-niveau længere køber nul for nogen spejder-rating (se
// backend/lib/scoutPrecisionInfo.test.js). Knappens dæmpning her er derfor et
// SIKKERHEDSNET, ikke en normaltilstand: den fanger regressionen hvis nogen
// (fx en fremtidig #3666-lignende rekalibrering) ændrer en konstant i
// scoutEngine/scoutingReport igen uden at måle konsekvensen for det næste
// scout-niveau. Uden dæmpningen ville spilleren kunne betale 1.000 CZ$ for en
// købsknap der siger "narrow" og leverer ingenting — igen.
//
// Samme kilde-scan-mønster som RiderScoutingTab.confidence.test.js: ingen
// jsdom/render-harness findes for denne komponent i dag, så testen låser
// wiringen i selve kildeteksten + at de anvendte i18n-nøgler findes i begge
// sprog.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const LOCALES = ["en", "da"];

function loadRiderLocale(lang) {
  const path = fileURLToPath(new URL(`../../../../public/locales/${lang}/rider.json`, import.meta.url));
  return JSON.parse(readFileSync(path, "utf8"));
}

function componentSource() {
  const path = fileURLToPath(new URL("./RiderScoutingTab.jsx", import.meta.url));
  return readFileSync(path, "utf8");
}

test("#3671: canScout dæmpes når serveren flagger nextLevelIsUseless", () => {
  const src = componentSource();
  assert.match(
    src,
    /nextLevelUseless\s*=\s*report\?\.precision\?\.nextLevelIsUseless\s*===\s*true/,
    "komponenten skal læse precision.nextLevelIsUseless fra rapporten, ikke regne selv (frontend må aldrig selv regne på halvbredder)",
  );
  assert.match(
    src,
    /const canScout = .*&&\s*!nextLevelUseless/,
    "canScout skal ekskludere nextLevelUseless — ellers er dæmpningen kun kosmetisk tekst, knappen forbliver klikbar",
  );
});

test("#3671: den dæmpede knap forklarer HVORFOR, ikke bare at den er slukket", () => {
  const src = componentSource();
  assert.match(
    src,
    /nextLevelUseless\s*\?\s*t\("scouting\.levelUseless"\)/,
    "disabled-knappen skal have en title der forklarer at spejderens præcisionsgrænse er nået, ikke bare arve scoutTitle",
  );
});

test("#3671: scouting.levelUseless findes og er meningsfuld i begge sprog", () => {
  for (const lang of LOCALES) {
    const scouting = loadRiderLocale(lang).scouting;
    const text = scouting?.levelUseless;
    assert.ok(text && text.trim(), `${lang}: scouting.levelUseless mangler`);
    assert.notEqual(
      text.trim(), scouting?.noSlots?.trim(),
      `${lang}: levelUseless må ikke være en kopi af noSlots — det er to forskellige årsager til at knappen er slukket`,
    );
  }
});

test("#3671: PrecisionNote-teksten (synlig linje) og knap-dæmpningen (sikkerhedsnet) er to uafhængige mekanismer", () => {
  // Regressions-forsikring mod at nogen fjerner den ene og tror den anden
  // dækker: PrecisionNote er altid synlig informativ tekst; canScout-gaten er
  // det der rent faktisk forhindrer købet. Begge skal stå i kildeteksten.
  const src = componentSource();
  assert.match(src, /function PrecisionNote/, "den forklarende linje under bånd-tabellen mangler");
  assert.match(src, /precision\.nextLevelIsUseless/, "PrecisionNote skal stadig vise advarslen i selve teksten");
});
